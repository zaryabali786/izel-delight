const express = require('express');
const { verifyAuth } = require('../middleware/auth.middleware');
const C = require('../controllers/connections.controller');

const router = express.Router();

// Public: providers redirect the browser here (identity is proven by the signed `state`).
router.get('/callback/:provider', C.callback);

router.use(verifyAuth);
router.get('/:storeId', C.list);
router.get('/:storeId/whatsapp-business/embedded-config', C.whatsappEmbeddedConfig);
router.post('/:storeId/whatsapp-business/embedded', C.whatsappEmbedded);
router.post('/:storeId/:provider/start', C.start);
router.put('/:storeId/:provider/accounts', C.setAccounts);
router.post('/:storeId/:provider/credentials', C.saveCredentials);
router.post('/:storeId/:provider/disconnect', C.disconnect);
router.post('/:storeId/:provider/sync', C.sync);

module.exports = router;
