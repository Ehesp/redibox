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
import cuid from 'cuid';

class Job {

  constructor(queue, jobId, data = {}, options = {
    unique: false,
    timeout: 60000 // 1 minute default timeout
  }) {
    this.queue = queue;
    this.rdb = this.queue.rdb;
    this.id = jobId;
    this.duplicate = false;
    this.progress = 0;
    this.data = data;
    this.options = options;
    this.subscriptions = [];
    this.status = 'created';
  }

  static fromId(queue, jobId) {
    return new Promise(function (resolve, reject) {
      queue.rdb.client.hget(queue.toKey('jobs'), jobId, function (err, data) {
        if (err) return reject(err);
        return resolve(Job.fromData(queue, jobId, data));
      });
    });
  }

  static fromData(queue, jobId, data) {
    // TODO possible error on redis flush / failure JSON parsed .data object null.
    const job = new Job(queue, jobId, JSON.parse(data).data, JSON.parse(data).options);
    job.status = data.status;
    return job;
  }

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
          return cb(new Error('Duplicate Job')); // TODO improve on this error message.
        }
        if (err) return cb(err);
        this.id = id;
        this.status = 'saved';
        this.queue.jobs[id] = this;
        return cb(null, this);
      }
    );
  }

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

  retries(n) {
    if (n < 0) {
      throw Error('Retries cannot be negative');
    }
    this.options.retries = n - 1;
    return this;
  }

  onSuccess(notify) {
    this.options.notifySuccess = true;
    this.onSuccessCallback = notify;
    if (!this.onFailureCallback) this.onFailureCallback = noop;
    return this;
  }

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

  timeout(ms) {
    if (ms < 0) {
      throw Error('Timeout cannot be negative.'); // TODO improve error message.
    }
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

  initialJob() {
    return this._internalData.initialJob;
  }

  initialQueue() {
    return this._internalData.initialQueue;
  }

  remove(cb = noop) {
    this.rdb.client.removejob(
      this.queue.toKey('succeeded'), this.queue.toKey('failed'), this.queue.toKey('waiting'),
      this.queue.toKey('active'), this.queue.toKey('stalling'), this.queue.toKey('jobs'),
      this.id, cb);
  }

  retry(cb = noop) {
    this.rdb.client.multi()
        .srem(this.queue.toKey('failed'), this.id)
        .lpush(this.queue.toKey('waiting'), this.id)
        .exec(cb);
  }

  isInSet(set, cb = noop) {
    this.rdb.client.sismember(this.queue.toKey(set), this.id, function (err, result) {
      if (err) return cb(err);
      return cb(null, result === 1);
    });
  }

}

export default Job;

