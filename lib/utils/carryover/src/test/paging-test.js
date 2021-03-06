'use strict';

const util = require('util');

const _ = require('underscore');
const extend = _.extend;
const times = _.times;

const moment = require('abacus-moment');

describe('Read carry-over usage with paging', () => {
  let dbEnv;
  let allDocsMock;
  let carryOver;
  let dbDocs;
  let dbclient;
  let statistics;
  let errorFn;

  const deleteModules = (cb = () => {}) => {
    // Delete cached modules exports
    delete require.cache[require.resolve('abacus-batch')];
    delete require.cache[require.resolve('abacus-breaker')];
    delete require.cache[require.resolve('abacus-dbclient')];
    delete require.cache[require.resolve('abacus-couchclient')];
    delete require.cache[require.resolve('abacus-mongoclient')];
    delete require.cache[require.resolve('abacus-paging')];
    delete require.cache[require.resolve('abacus-request')];
    delete require.cache[require.resolve('abacus-retry')];
    delete require.cache[require.resolve('abacus-throttle')];
    delete require.cache[require.resolve('abacus-yieldable')];
    delete require.cache[require.resolve('..')];

    cb();
  };

  before(() => {
    dbEnv = process.env.DB;

    // Configure test db URL prefix
    process.env.DB = process.env.DB || 'test';
  });

  after(() => {
    process.env.DB = dbEnv;
  });

  beforeEach(() => {
    deleteModules();

    // Mock the cluster module
    const cluster = require('abacus-cluster');
    require.cache[require.resolve('abacus-cluster')].exports =
      extend((app) => app, cluster);

    // Disable the batch, retry, breaker and throttle modules
    require('abacus-batch');
    require.cache[require.resolve('abacus-batch')].exports = (fn) => fn;
    require('abacus-retry');
    require.cache[require.resolve('abacus-retry')].exports = (fn) => fn;
    require('abacus-breaker');
    require.cache[require.resolve('abacus-breaker')].exports = (fn) => fn;
    require('abacus-throttle');
    require.cache[require.resolve('abacus-throttle')].exports = (fn) => fn;

    // Mock the dbclient module
    dbclient = require('abacus-dbclient');
    const dbclientModule = require.cache[require.resolve('abacus-dbclient')];
    dbclientModule.exports = extend(() => {
      return {
        fname: 'test-mock',
        allDocs: allDocsMock
      };
    }, dbclient);

    statistics = {
      carryOver: {
        readSuccess: 0,
        readFailure: 0,
        docsRead: 0
      }
    };
    errorFn = spy();
  });

  afterEach(() => {
    deleteModules();

    allDocsMock = undefined;
    carryOver = undefined;
    dbclient = undefined;
    dbDocs = undefined;
  });

  const monthStart = moment.utc().startOf('month').valueOf();

  const buildDbDocs = (num) => ({
    rows: times(num, (n) => ({
      doc: {
        _id: dbclient.kturi(util.format('app:%d', n), monthStart),
        collector_id: util.format('%d', n)
      }
    }))
  });

  context('success', () => {
    beforeEach((done) => {
      dbDocs = buildDbDocs(10);

      allDocsMock = spy((opt, cb) => {
        cb(undefined, dbDocs);
      });

      carryOver = require('..')(statistics, errorFn);
      carryOver.readPage('start', 'end', 10, 0, (error, docs) => {
        expect(error).to.equal(undefined);
        expect(docs).not.to.equal(undefined);
        expect(docs.length).to.equal(10);
        done();
      });
    });

    it('populates statistics object', () => {
      expect(statistics.carryOver.readSuccess).to.equal(1);
      expect(statistics.carryOver.readFailure).to.equal(0);
      expect(statistics.carryOver.docsRead).to.equal(10);
    });

    it('error function is not called', () => {
      sinon.assert.notCalled(errorFn);
    });
  });

  context('failure', () => {
    const testError = new Error('test error');

    beforeEach((done) => {
      dbDocs = buildDbDocs(10);

      allDocsMock = spy((opt, cb) => {
        cb(testError, dbDocs);
      });

      carryOver = require('..')(statistics, errorFn);
      carryOver.readPage('start', 'end', 10, 0, (error, docs) => {
        expect(error).to.equal(testError);
        done();
      });
    });

    it('populates statistics object', () => {
      expect(statistics.carryOver.readSuccess).to.equal(0);
      expect(statistics.carryOver.readFailure).to.equal(1);
      expect(statistics.carryOver.docsRead).to.equal(0);
    });

    it('error function is called', () => {
      expect(errorFn.callCount).to.equal(1);
      sinon.assert.alwaysCalledWith(errorFn,
        'Failed reading usage data from start to end with limit 10 and skip 0',
        testError, undefined, 'carryOver');
    });
  });
});
