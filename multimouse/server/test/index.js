'use strict';
// Entry so `node --test <this test directory>` works on Node 22+, which treats a directory argument as a
// module path instead of expanding it. Only the unit tests run here; sim.js, integration.js and
// panel-smoke.js are scripts with required arguments and are run by hand.
require('./jam-core.test.js');
require('./osc-codec.test.js');
