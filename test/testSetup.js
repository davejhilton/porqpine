var chai = require('chai');
var chaiAsPromised = require('chai-as-promised');
var sinonChai = require('sinon-chai');
var sinon = require('sinon');
var expect = chai.expect;
var Promise = require('bluebird');

require('sinon-as-promised')(Promise);

chai.use(chaiAsPromised);
chai.use(sinonChai);

global.sinon = sinon;
global.expect = expect;