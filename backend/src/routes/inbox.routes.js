const express = require('express');
const { verifyAuth } = require('../middleware/auth.middleware');
const InboxController = require('../controllers/inbox.controller');

const router = express.Router();
router.use(verifyAuth);

router.get('/:storeId/conversations', InboxController.getConversations);
router.get('/:storeId/conversations/:id', InboxController.getConversation);
router.post('/:storeId/conversations/:id/messages', InboxController.sendMessage);
router.post('/:storeId/conversations/:id/comment-action', InboxController.performCommentAction);
router.post('/:storeId/conversations/:id/ai-reply', InboxController.generateAiReply);
router.delete('/:storeId/conversations/:id/draft', InboxController.dismissDraft);
router.put('/:storeId/conversations/:id/status', InboxController.updateStatus);
router.put('/:storeId/conversations/:id/ai-pause', InboxController.setAiPaused);

router.get('/:storeId/posts', InboxController.getPosts);
router.post('/:storeId/sync', InboxController.syncSocial);

module.exports = router;
