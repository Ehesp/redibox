'use strict';

import { assert, expect, should} from 'chai';
import RediBox from './../../src';

describe('core', () => {

  it('Should fail to connect to a dead redis server', function (done) {
    this.timeout(10000);

    const clientOne = new RediBox({
      redis: {port: 9999, connectionTimeout: 2500}
    }, function (err) {
      assert.isNotNull(err, err.message);
      done();
    });
  });

  it('Should connect to default redis', function (done) {
    this.timeout(9000);
    const clientTwo = new RediBox();
    clientTwo.once('ready', function () {
      // get any key just to test the connection.
      clientTwo.get('test', done);
    });
  });

});
