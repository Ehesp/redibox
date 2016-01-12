# redibox

![Build Status](https://img.shields.io/travis/redibox/redibox.svg)
![Coverage](https://img.shields.io/coveralls/redibox/redibox.svg)
![Downloads](https://img.shields.io/npm/dm/redibox.svg)
![Downloads](https://img.shields.io/npm/dt/redibox.svg)
![npm version](https://img.shields.io/npm/v/redibox.svg)
![dependencies](https://img.shields.io/david/redibox/redibox.svg)
![dev dependencies](https://img.shields.io/david/dev/redibox/redibox.svg)
![License](https://img.shields.io/npm/l/redibox.svg)

Ultimate redis toolbox for node. Built using ES6/ES7 features.

## Planned Features
 - :white_check_mark: **Caching**, including easy wrapper helpers, e.g `wrapPromise`, `wrapWaterlineQuery` (for sails), `wrapExpressRequest`
 - :white_check_mark: **Redis Clusters** with optional cluster scaled slave reads.
 - :white_medium_square: **Distributed Locks** using Redlock algorithm `acquire`, `release`, `renew` locks.
 - :white_medium_square: **Throttling**, limit something to X times per Y time period with one easy call, for example: api requests.
 - :large_orange_diamond: Custom **LUA Commands**
      - ```javascript
        // Turns this,
        {
             mycommand: {
               keys: 1,
               lua: `
                   --[[
                     key 1 -> key name
                     arg 1 -> someArg
                     arg 2 -> someOtherArg
                   ]]

                   if redis.call('exists',KEYS[1]) > 0 then
                     return 0
                   else
                     redis.call('setex',KEYS[1],tonumber(ARGV[1]),ARGV[2])
                     return 1
                   end
             `
             },
       }
       // into this:
       RediBox.mycommand('key', 'arg1','arg2').then().catch();
       ```
  - :large_orange_diamond: **Time Series** want pretty stats and graphs? This will generate hits and allow easy query of data with range filtering.

## Getting Started

Pre-alpha so not quite usable yet. Come back in a few days :)

Install it via npm:

```shell
npm install redibox
```

And include in your project:

```javascript
import redibox from 'redibox';
const RediBox = new redibox();
```

## License

MIT
