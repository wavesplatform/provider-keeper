import { ProviderKeeper } from './ProviderKeeper';
import { ConnectOptions } from '@waves/signer';

export function ensureNetwork(
  target,
  propertyKey: string,
  descriptor: PropertyDescriptor
) {
  const origin = descriptor.value;

  descriptor.value = function (
    this: { [Key in keyof ProviderKeeper]: ProviderKeeper[Key] } & {
      _apiPromise: Promise<WavesKeeper.TWavesKeeperApi>;
      _connectPromise: Promise<void>;
      _options: ConnectOptions;
    },
    ...args: Array<any>
  ) {
    return Promise.all([this._apiPromise, this._connectPromise])
      .then(([api]) => api.publicState())
      .then(state => {
        const nodeUrl = state.network.server;
        const networkByte = state.network.code.charCodeAt(0);
        if (networkByte !== this._options.NETWORK_BYTE) {
          throw new Error(
            `Invalid connect options. Signer connect (${this._options.NODE_URL} ${this._options.NETWORK_BYTE}) not equals keeper connect (${nodeUrl} ${networkByte})`
          );
        }
        return origin.apply(this, args);
      });
  };
}
