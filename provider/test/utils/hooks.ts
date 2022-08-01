import { Builder, By, until, WebDriver } from 'selenium-webdriver';
import * as chrome from 'selenium-webdriver/chrome';
import * as net from 'net';
import * as mocha from 'mocha';
import * as path from 'path';
import * as httpServer from 'http-server';
import {
  GenericContainer,
  Network,
  StartedTestContainer,
  TestContainers,
} from 'testcontainers';
import * as fs from 'fs';

declare module 'mocha' {
  interface Context {
    driver: WebDriver;
    extensionUrl: string;
    testAppUrl: string;
    nodeUrl: string;
    wait: number;
  }
}

interface GlobalFixturesContext {
  selenium: StartedTestContainer;
  node: StartedTestContainer;
  testApp: httpServer.HttpServer;
}

export async function mochaGlobalSetup(this: GlobalFixturesContext) {
  const rootDir = path.resolve(__dirname, '..', '..', '..');
  const wavesKeeperDir = path.resolve(rootDir, 'dist');
  const testAppDir = path.resolve(rootDir, 'test-app', 'dist');

  if (
    !fs.existsSync(wavesKeeperDir) ||
    fs.readdirSync(wavesKeeperDir).length === 0
  ) {
    throw new Error(
      `
      You should build or download latest Keeper Wallet for e2e tests.
      See more at .github/workflows/tests.yml
      `
    );
  }

  if (!fs.existsSync(testAppDir) || fs.readdirSync(testAppDir).length === 0) {
    throw new Error(
      `
      You should build test application first.
      See more at .github/workflows/tests.yml
      `
    );
  }

  const host = await new Network().start();

  this.node = await new GenericContainer('wavesplatform/waves-private-node')
    .withExposedPorts(6869)
    .withNetworkMode(host.getName())
    .withNetworkAliases('waves-private-node')
    .start();

  this.testApp = httpServer.createServer({ root: testAppDir });
  this.testApp.listen(8081, '0.0.0.0', function () {});

  await TestContainers.exposeHostPorts(8081);

  const seleniumPorts = [4444, 5900];
  this.selenium = await new GenericContainer('selenium/standalone-chrome')
    .withBindMount(path.resolve(wavesKeeperDir), '/app/waves_keeper', 'ro')
    .withExposedPorts(...seleniumPorts)
    .withNetworkMode(host.getName())
    .start();

  await Promise.all(
    seleniumPorts.map(
      (port: number) =>
        new Promise((resolve, reject) => {
          net
            .createServer(from => {
              const to = net.createConnection({
                port: this.selenium.getMappedPort(port),
              });

              from.pipe(to);
              to.pipe(from);

              to.once('error', () => {
                from.destroy();
              });
            })
            .once('listening', resolve)
            .once('error', reject)
            .listen(port)
            .unref();
        })
    )
  );
}

export async function mochaGlobalTeardown(this: GlobalFixturesContext) {
  await this.selenium.stop();
  await this.node.stop();
  this.testApp.close();
}

export const mochaHooks = () => ({
  async beforeAll(this: mocha.Context) {
    this.timeout(15 * 60 * 1000);
    this.wait = 10 * 1000;

    this.driver = new Builder()
      .forBrowser('chrome')
      .usingServer(`http://localhost:4444/wd/hub`)
      .setChromeOptions(
        new chrome.Options().addArguments(
          `--load-extension=/app/waves_keeper`,
          '--disable-dev-shm-usage',
          '--disable-web-security'
        )
      )
      .build();

    // detect Keeper Wallet extension URL
    await this.driver.get('chrome://system');
    for (const ext of (
      await this.driver
        .wait(until.elementLocated(By.css('div#extensions-value')))
        .getText()
    ).split('\n')) {
      const [id, name] = ext.split(' : ');
      if (name.toLowerCase() === 'Keeper Wallet'.toLowerCase()) {
        this.extensionUrl = `chrome-extension://${id}/popup.html`;
        break;
      }
    }

    this.testAppUrl = 'http://host.testcontainers.internal:8081';
    this.nodeUrl = 'http://waves-private-node:6869';
  },

  afterAll(this: mocha.Context, done: mocha.Done) {
    this.driver && this.driver.quit();
    done();
  },
});
