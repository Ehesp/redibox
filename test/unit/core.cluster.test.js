'use strict';

import { assert } from 'chai';
import RediBox from './../../src';

/**
 * These tests require a cluster running locally:
 * Just type the following commands using the redis create-cluster script
 * which can be found in the redis download package under utils/create-cluster.
 *    1) create-cluster start
 *    2) create-cluster create
 */

describe('core cluster', () => {
  it('Should connect to a cluster and create an additional READONLY client for slave scaled reads.', function (done) {
    this.timeout(9000);
    const client = new RediBox({
      redis: {
        cluster: true,
        clusterScaleReads: true,
        connectionTimeout: 9000,
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
      }
    }, function (err, cluster) {
      assert.equal(cluster.client, 'ready');
      // check read client was created also in this instance
      assert.equal(cluster.client_read, 'ready');
      assert.isNull(err, 'Cluster Connected!');
      done();
    });
  });


  it('Should connect to a cluster and create single client only.', function (done) {
    this.timeout(6000);
    const client = new RediBox({
      redis: {
        cluster: true,
        clusterScaleReads: false, // single client only
        connectionTimeout: 5900,
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
      }
    }, function (err, cluster) {
      assert.equal(cluster.client, 'ready');
      // check read client was NOT created in this instance
      assert.equal(cluster.client_read, null);
      assert.isNull(err, 'Cluster Connected!');
      done();
    });
  });
});
