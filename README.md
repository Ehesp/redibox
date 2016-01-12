# RediBox

![Build Status](https://img.shields.io/travis/salakar/redibox.svg)
![Coverage](https://img.shields.io/coveralls/salakar/redibox.svg)
![Downloads](https://img.shields.io/npm/dm/redibox.svg)
![Downloads](https://img.shields.io/npm/dt/redibox.svg)
![npm version](https://img.shields.io/npm/v/redibox.svg)
![dependencies](https://img.shields.io/david/salakar/redibox.svg)
![dev dependencies](https://img.shields.io/david/dev/salakar/redibox.svg)
![License](https://img.shields.io/npm/l/redibox.svg)

Ultimate redis toolbox for node. Built using ES6/ES7 features and as lightweight as possible with just 2 dependencies, ioredis and winston.

## Planned Features
 - :white_check_mark: **[Caching](/src/modules/cache/README.md)**, including easy wrapper helpers, e.g `wrapPromise`, `wrapWaterlineQuery` (for sails), `wrapExpressRequest`
 - :white_check_mark: **Redis Clusters** with optional cluster scaled slave reads.
 - :white_medium_square: **Distributed Locks** using Redlock algorithm `acquire`, `release`, `renew` locks.
 - :white_medium_square: **Throttling**, limit something to X times per Y time period with one easy call, for example: api requests.
 - :large_orange_diamond: Custom **LUA Commands**
 - :large_orange_diamond: **Time Series** want pretty stats and graphs? This will generate hits and allow easy query of data with range filtering.
 - :white_check_mark: Indexes - http://redis.io/topics/indexes wrappers for to aid using redis as a secondary index or for things like autocompletion.

## Getting Started

Pre-alpha so not quite usable yet. Come back in a few days :)

Install it via npm:

```shell
npm install redibox
```

And include in your project:

```javascript
import Redibox from 'redibox'; 
const rediBox = new RediBox({
  redis: {
    port: 7777
  }
}); // optional callback for bootstrap ready status or use events:

rediBox.on('ready' function(clientStatus) {
  rediBox.log.info(error); // internal redibox instance of winston if needed.
  // use cache module to set a cached value with a 60 second validity time.
  rediBox.cache.set('myKey', 'myVal', 60); // use a callback or a promise
});

rediBox.on('error' function(error) {
  rediBox.log.error(error); // internal redibox instance of winston if needed.
});
```


## RediBox Core

#### RediBox.quit();
Force close all redis client connections without waiting for any pending replies. 

#### RediBox.disconnect();
Close all redis client connections but wait for any pending replies first.

#### RediBox.getReadOnlyClient();
Returns a redis client for read only purposes. This is useful for cluster mode where `redis.clusterScaleReads` is set to `true`. This client is able to read from redis cluster slaves.

#### RediBox.getClient();
Returns a read/write redis client.

#### static RediBox.isClientConnected(client);
Returns the connection state of the redis client provided.

## Module Documentation

 - [Cache] (/src/modules/cache/README.md)


## License

MIT
