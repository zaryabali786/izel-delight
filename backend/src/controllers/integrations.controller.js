const IntegrationsService = require('../services/integrations.service');
const StoreService = require('../services/store.service');

const IntegrationsController = {
  /**
   * GET /api/integrations/:storeId
   * Retrieve all integrations for a store (secrets masked)
   */
  async getIntegrations(req, res, next) {
    try {
      const { storeId } = req.params;

      const store = await StoreService.getStoreById(storeId, req.user.id);
      if (!store) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: Store does not belong to your account.',
        });
      }

      const integrations = await IntegrationsService.getStoreIntegrationsSanitized(storeId, req.user.id);
      return res.status(200).json({
        success: true,
        integrations,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/integrations/connect
   * Validate credentials against official provider API and store securely
   */
  async connectIntegration(req, res, next) {
    try {
      const { storeId, provider, fields } = req.body;

      if (!storeId || !provider || !fields) {
        return res.status(400).json({
          success: false,
          error: 'Fields "storeId", "provider", and "fields" are required.',
        });
      }

      // Strict tenant isolation check
      const store = await StoreService.getStoreById(storeId, req.user.id);
      if (!store) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: Store does not belong to your account.',
        });
      }

      // 1. Verify credentials with official API
      let validationResult;
      try {
        validationResult = await IntegrationsService.validateProviderCredentials(provider, fields);
      } catch (validationErr) {
        // Return real provider error, no fake success!
        return res.status(400).json({
          success: false,
          error: validationErr.message,
        });
      }

      // 2. Persist with AES-256-GCM encryption
      const saved = await IntegrationsService.saveIntegration(
        storeId,
        req.user.id,
        provider,
        fields
      );

      return res.status(200).json({
        success: true,
        message: `${provider} credentials verified and securely connected.`,
        validation: validationResult,
        integration: {
          provider,
          status: 'connected',
          last_synced_at: saved.last_synced_at,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/integrations/disconnect
   * Disconnect integration and wipe stored keys
   */
  async disconnectIntegration(req, res, next) {
    try {
      const { storeId, provider } = req.body;

      if (!storeId || !provider) {
        return res.status(400).json({
          success: false,
          error: 'Fields "storeId" and "provider" are required.',
        });
      }

      const store = await StoreService.getStoreById(storeId, req.user.id);
      if (!store) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: Store does not belong to your account.',
        });
      }

      await IntegrationsService.disconnectIntegration(storeId, req.user.id, provider);

      return res.status(200).json({
        success: true,
        message: `Integration "${provider}" has been disconnected.`,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/integrations/test
   * Test live credentials without saving
   */
  async testConnection(req, res, next) {
    try {
      const { provider, fields } = req.body;

      if (!provider || !fields) {
        return res.status(400).json({
          success: false,
          error: 'Fields "provider" and "fields" are required.',
        });
      }

      const result = await IntegrationsService.validateProviderCredentials(provider, fields);
      return res.status(200).json({
        success: true,
        message: 'Credentials valid and active.',
        details: result,
      });
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: err.message,
      });
    }
  },

  /**
   * POST /api/integrations/sync
   * Trigger live sync for a specific store and provider
   */
  async syncIntegration(req, res, next) {
    try {
      const { storeId, provider } = req.body;

      if (!storeId || !provider) {
        return res.status(400).json({
          success: false,
          error: 'Fields "storeId" and "provider" are required.',
        });
      }

      const store = await StoreService.getStoreById(storeId, req.user.id);
      if (!store) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: Store does not belong to your account.',
        });
      }

      const result = await IntegrationsService.syncIntegration(storeId, req.user.id, provider);
      return res.status(200).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = IntegrationsController;
