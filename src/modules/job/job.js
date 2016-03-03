/**
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2015 Salakar
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 */

import {noop, sha1sum} from './../../helpers';
import Promise from 'bluebird';
import cuid from 'cuid';

class Job {

  constructor(rdb, id, data = {}, options = {
    unique: false,
    timeout: 60000 // 1 minute default timeout
  }, queueName) {
    this.id = id;
    this.rdb = rdb;
    this.data = data;
    this.status = 'created';
    this.options = options;
    this.progress = 0;
    this.duplicate = false;
    this.queueName = queueName;
    this.subscriptions = [];
  }

	/**
   *
   * @param queue
   * @param id
   */
  static fromId(queue, id) {
    return new Promise(function (resolve, reject) {
      queue.rdb.client.hget(queue.toKey('jobs'), id, function (err, data) {
        if (err) return reject(err);
        return resolve(Job.fromData(queue, id, data));
      });
    });
  }

	/**
   *
   * @param queue
   * @param id
   * @param data
   * @returns {Job}
	 */
  static fromData(queue, id, data) {
    // TODO possible error on redis flush / failure JSON parsed .data object null.
    const job = new Job(queue.rdb, id, JSON.parse(data).data, JSON.parse(data).options, queue.name);
    job.status = data.status;
    return job;
  }

	/**
   *
   */
  toData() {
    return JSON.stringify({
      id: this.id,
      data: this.data,
      options: this.options,
      status: this.status
    });
  }

  /**
   * Internal saver.
   * @param cb
   * @private
   */
  _save(cb) {
    this.rdb.log.verbose(`Saving new job ${this.id} for ${this.queue.name}`);
    this.rdb.client.addjob(
      this.queue.toKey('jobs'),
      this.queue.toKey('waiting'),
      this.queue.toKey('id'),
      this.toData(),
      !!this.options.unique,
      this.id, (err, id) => {
        this.rdb.log.verbose(`Saved job for ${this.queue.name}`);
        if (id === 0 && this.options.unique) {
          this.duplicate = true;
          return cb(new Error('Duplicated Job')); // TODO improve on this error message.
        }
        if (err) return cb(err);
        this.id = id;
        this.status = 'saved';
        this.queue.jobs[id] = this;
        return cb(null, this);
      }
    );
  }

	/**
   *
   * @param cb
   * @returns {*}
   */
  save(cb = noop) {
    this.id = this.queue.name + '-' + (this.options.unique ? sha1sum(this.data) : cuid());

    if (this.options.notifySuccess) {
      this.options.notifySuccess = `job:${this.id}:success`;
      this.subscriptions.push(`job:${this.id}:success`);
    }

    if (this.options.notifyFailure) {
      this.options.notifyFailure = `job:${this.id}:failure`;
      this.subscriptions.push(`job:${this.id}:failure`);
    }

    if (this.options.notifySuccess || this.options.notifyFailure) {
      return this.rdb.subscribeOnceOf(
        this.subscriptions, (message) => { // on message received
          const channel = message.channel;

          // remove the pubsub data
          if (message.data) {
            message = message.data;
          }

          // if there's an error the assume failed.
          if (message.error) {
            return this.onFailureCallback(message);
          }

          // is it from the success channel.
          if (this.subscriptions[0] === channel) {
            return this.onSuccessCallback(message);
          }

          return this.onFailureCallback(message);
        }, (err) => { // subscribed callback
          if (err) {
            this.onFailureCallback({
              type: 'job',
              error: new Error('Error while subscribing to job events, however this job will still be queued - ' +
                'you may be unable to receive onComplete / onFailure events for this job.')
            });
          }
          this._save(cb);
          // adding a additional 2s onto the subscribe timeout to allow timeout
          // on the job to emit it's own timeout event.
        }, this.options.timeout + 2000);
    }
    this._save(cb);
    return this;
  }

	/**
   * Set the number of times this job will retry on failure
   * @param n
   * @returns {Job}
   */
  retries(n) {
    if (n < 0) {
      throw Error('Retries cannot be negative');
    }
    this.options.retries = n - 1;
    return this;
  }

	/**
   * Set the onSuccess callback and notify option
   * @param notify
   * @returns {Job}
   */
  onSuccess(notify) {
    this.options.notifySuccess = true;
    this.onSuccessCallback = notify;
    if (!this.onFailureCallback) this.onFailureCallback = noop;
    return this;
  }

	/**
   * Set the onFailure callback and notify option
   * @param notify
   * @returns {Job}
   */
  onFailure(notify) {
    this.options.notifyFailure = true;
    this.onFailureCallback = notify;
    if (!this.onSuccessCallback) this.onSuccessCallback = noop;
    return this;
  }

  unique(bool) {
    this.options.unique = bool;
    return this;
  }

	/**
   * Set how long this job can run before it times out.
   * @param ms
   * @returns {Job}
   */
  timeout(ms) {
    this.options.timeout = ms;
    return this;
  }

  // todo pub sub events to track progress
  reportProgress(progress, cb = noop) {
    // right now we just send the pubsub event
    // might consider also updating the job hash for persistence
    if (Number(progress) < 0 || Number(progress) > 100) {
      return process.nextTick(cb.bind(null, Error('Progress must be between 0 and 100')));
    }
    this.progress = Number(progress);
    this.rdb.publisher.publish(this.queue.toKey('events'), JSON.stringify({
      id: this.id,
      event: 'progress',
      data: progress
    }), cb);
  }

	/**
   *
   * @returns {Job.initialJob|*}
   */
  initialJob() {
    return this._internalData.initialJob;
  }

	/**
   *
   * @returns {Job.initialQueue|*}
   */
  initialQueue() {
    return this._internalData.initialQueue;
  }

	/**
   *
   * @param cb
   */
  remove(cb = noop) {
    this.rdb.client.removejob(
      this.queue.toKey('succeeded'), this.queue.toKey('failed'), this.queue.toKey('waiting'),
      this.queue.toKey('active'), this.queue.toKey('stalling'), this.queue.toKey('jobs'),
      this.id, cb);
  }

	/**
   *
   * @param cb
   */
  retry(cb = noop) {
    this.rdb.client.multi()
        .srem(this.queue.toKey('failed'), this.id)
        .lpush(this.queue.toKey('waiting'), this.id)
        .exec(cb);
  }

	/**
   *
   * @param set
   * @param cb
   */
  isInSet(set, cb = noop) {
    this.rdb.client.sismember(this.queue.toKey(set), this.id, function (err, result) {
      if (err) return cb(err);
      return cb(null, result === 1);
    });
  }

	/**
   * Generates a queue prefixed key based on the provided string.
   * @param str
   * @returns {string}
   * @private
   */
  _toQueueKey(str:string):string {
    if (this.rdb.isCluster()) {
      return `${this.options.prefix}:{${this.queueName}}:${str}`;
    }
    return `${this.options.prefix}:${this.queueName}:${str}`;
  }


}

export default Job;

