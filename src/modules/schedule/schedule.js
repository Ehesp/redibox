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

import interval from './interval';
import chrono from 'chrono-node';

export default class Schedule {

  constructor(scheduler, scheduleName:string, scheduleOptions = {}) {
    this.name = scheduleName;
    this.scheduler = scheduler;
    this.options = Object.assign({
      startAt: false,
      startIn: false,
      stopAt: false,
      stopIn: false,
      repeat: false,
      every: false,
      times: false
    }, scheduleOptions);
    return this;
  }

  startAt(time) {
    this.options.startAt = Schedule.validateTimeAtInput(time);
    return this;
  }

  startIn(time) {
    this.options.startIn = interval.human(time);
    return this;
  }

  stopAt(time) {
    this.options.stopAt = Schedule.validateTimeAtInput(time);
    return this;
  }

  stopIn(time) {
    this.options.stopIn = interval.human(time);
    return this;
  }

  repeat(bool:boolean) {
    this.options.repeat = bool;
    return this;
  }

  every(time) {
    this.options.every = interval.human(time);
  }

  static validateTimeAtInput(time) {
    // if a valid date or number just return it
    if (typeof time === 'number' || time instanceof Date) {
      return time instanceof Date ? time.getTime() : time;
    }

    // try parse via chrono;
    const parsed = chrono.parse(time);

    if (parsed && parsed.length && parsed[0].date() && parsed[0].date() > new Date()) {
      return parsed[0].date().getTime();
    }

    // not a valid type, throw an error
    throw new TypeError('Invalid date format specified, must be a Number, ' +
      'instance of Date or a valid human date string and be in the future.');
  }
}

