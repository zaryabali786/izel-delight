const express = require('express');
const router = express.Router();
const OrdersController = require('../controllers/orders.controller');
const { verifyAuth } = require('../middleware/auth.middleware');

router.use(verifyAuth);

router.get('/:storeId', OrdersController.getOrders);
router.post('/:storeId', OrdersController.createOrder);
router.put('/:storeId/:orderId', OrdersController.updateOrder);

module.exports = router;
