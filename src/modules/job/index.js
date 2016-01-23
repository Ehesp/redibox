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

import {mergeDeep} from './../../helpers';
import Queue from './queue';

export default class Job {

  constructor(options, rdb) {
    this.rdb = rdb;
    this._queues = {};
    this.options = {
      enabled: false
    };

    mergeDeep(this.options, options);

    if (this.options.enabled) {
      if (this.options.queues && Array.isArray(this.options.queues)) {
        this.options.queues.forEach(queue => this.queueCreate(queue));
      }
      this.rdb.log.verbose(`${this.constructor.name} module has been mounted!`);
    }
  }

  /**
   * Creates a new job for the specified queue
   * @param queue
   * @param data
   * @returns {*|Job}
   */
  create(queue:string, data) {
    if (!this._queues[queue]) {
      throw new Error('Cannot find the queue specified.');
    }
    this.rdb.log.verbose(`Creating task for ${queue}`);
    return this._queues[queue].createJob(data);
  }

  queueCreate(queue) {
    this.rdb.log.verbose(`[${this.constructor.name}]: queue '${queue.name}' created!`);
    this._queues[queue.name] = new Queue({...queue, ...this.options}, this.rdb);
    this._queues[queue.name].rdb = this.rdb;
    //this._queues[queue.name].process(queue.concurrency);
  }


  queueDestroy(queue) {
    // TODO
  }

  queuePause(queue) {
    // TODO
  }

  queueResume(queue) {
    // TODO
  }
}
