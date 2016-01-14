const Benchmark = require('benchmark');
const suite = new Benchmark.Suite();
const Rbox = require('./../lib').default;

/**
 * To benchmark with a local cluster,
 * Just type the following commands using the redis create-cluster script
 * which can be found in the redis download archive under utils/create-cluster.
 *    1) create-cluster start
 *    2) create-cluster create
 * and then add in the below config,
 * ```
 redis: {
        cluster: true,
        clusterScaleReads: true,
        connectionTimeout: 12000,
        hosts: [
          {
            host: '127.0.0.1',
            port: 30001
          },
          {
            host: '127.0.0.1',
            port: 30002
          },
          {
            host: '127.0.0.1',
            port: 30003
          },
          {
            host: '127.0.0.1',
            port: 30004
          },
          {
            host: '127.0.0.1',
            port: 30005
          },
          {
            host: '127.0.0.1',
            port: 30006
          }
        ]
      },
 ```
 */

// create new instance of RediBox
const RediBox = new Rbox({
  log: {
    level: 'verbose'
  }
});

RediBox.on('error', function (error) {
  RediBox.log.error(error);
});

RediBox.on('ready', function (status) {
  RediBox.log.info(`Client status is: ${status.client}`);

  //console.dir(RediBox.throttle.seconds(60));
  //console.dir(RediBox.throttle.months(12));

  if (status.client_read) {
    RediBox.log.info(`Client status is: ${status.client}`);
  }

  RediBox.log.info(`Adding Benchmark 'RediBox Cache Get'`);
  suite.add('RediBox Cache Get', {
    defer: true,
    fn: function (deferred) {
      RediBox.cache.get(123456).then(() => {
        deferred.resolve();
      }).catch(function (err) {
        deferred.resolve(err);
        RediBox.log.error(err);
      });
    }
  });

  RediBox.log.info(`Adding Benchmark 'RediBox Cache Set'`);
  suite.add('RediBox Cache Set', {
    defer: true,
    fn: function (deferred) {
      RediBox.cache.set(123456, 45678, () => {
        deferred.resolve();
      });
    }
  });

  // add listeners
  suite.on('cycle', function (event) {
    RediBox.log.info(String(event.target));
  });

  suite.on('complete', function () {
    RediBox.log.info('\nFastest is ' + this.filter('fastest').map('name'));
    process.exit();
  });

  RediBox.log.info(`Starting Benchmarks: \n`);
  suite.run({async: true});
});
