import { createFilter } from '@rollup/pluginutils';
import { readFileSync } from 'fs';

export function base64(opts = {}) {
  if (!opts.include) {
    throw Error("include option must be specified");
  }

  const filter = createFilter(opts.include, opts.exclude);
  return {
    name: "base64",
    transform(data, id) {
      if (filter(id)) {
        const fileData = readFileSync(id);
          return {
            code: `export default "${fileData.toString('base64')}";`,
            map: null
          }
      }
    }
  };
}
