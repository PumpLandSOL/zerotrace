// local dev: DEV_FAUCET on, short mixing time so the Vault flow can be walked end to end
process.env.DEV_FAUCET = process.env.DEV_FAUCET || '1'; process.env.ANON_DELAY = process.env.ANON_DELAY || '20'; process.env.DATA_PATH = process.env.DATA_PATH || require('path').join(__dirname, '..', 'data.dev.json');
require('../server/index.js');
