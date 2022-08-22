import { Serializer } from '..';
import { Codec } from '../../../utils/screeps-utf15';

const numberCodec = new Codec({ array: false });

export const NumberSerializer: Serializer<number> = {
  key: 'ns',
  serialize(target?: number) {
    if (target === undefined) return undefined;
    return numberCodec.encode(target);
  },
  deserialize(target?: string) {
    if (target === undefined) return undefined;
    return numberCodec.decode(target);
  }
};
