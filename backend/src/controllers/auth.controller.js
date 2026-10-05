const { supabasePublic, supabaseAdmin } = require('../config/supabase');
const {
  sendVerificationEmail,
  generateVerificationToken,
  verifyToken,
} = require('../services/email.service');

/**
 * @desc    Register a new user & trigger email verification
 * @route   POST /api/auth/signup
 * @access  Public
 * @body    { email, password, full_name?, store_name? }
 */
const signup = async (req, res) => {
  try {
    const { email, password, full_name, store_name, company } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required.',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.',
      });
    }

    const assignedStoreName = (store_name || company || `${full_name || 'My'} Store`).trim();
    const cleanEmail = email.trim().toLowerCase();

    // Check if user already exists
    let existingUser = null;
    try {
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
      existingUser = usersData?.users?.find((u) => u.email?.toLowerCase() === cleanEmail);
    } catch (_) {}

    let userRecord = null;

    if (existingUser) {
      if (existingUser.email_confirmed_at) {
        return res.status(400).json({
          success: false,
          message: 'An account with this email address already exists. Please sign in.',
        });
      }
      // If user exists but is unconfirmed, update password & metadata
      const { data: updated, error: updErr } = await supabaseAdmin.auth.admin.updateUserById(existingUser.id, {
        password,
        user_metadata: {
          full_name: full_name || '',
          store_name: assignedStoreName,
          company: assignedStoreName,
        },
      });
      if (updErr) {
        return res.status(400).json({ success: false, message: updErr.message });
      }
      userRecord = updated.user;
    } else {
      // Create user via Admin API with email_confirm: false
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: cleanEmail,
        password,
        email_confirm: false,
        user_metadata: {
          full_name: full_name || '',
          store_name: assignedStoreName,
          company: assignedStoreName,
        },
      });

      if (createErr) {
        return res.status(400).json({
          success: false,
          message: createErr.message,
        });
      }
      userRecord = created.user;
    }

    // Auto-provision initial isolated store for the new tenant
    let initialStore = null;
    if (userRecord?.id) {
      try {
        const StoreService = require('../services/store.service');
        initialStore = await StoreService.createStore(userRecord.id, {
          name: assignedStoreName,
          platform: 'Shopify',
          currency: 'PKR',
        });
      } catch (err) {
        console.warn('[AuthController] Auto store provision warning:', err.message);
      }

      // Generate verification token and 6-digit OTP
      const { token, otpCode } = generateVerificationToken(userRecord, assignedStoreName);

      // Send verification email via GoDaddy SMTP and await delivery
      try {
        await sendVerificationEmail({
          name: full_name || '',
          email: cleanEmail,
          storeName: assignedStoreName,
          token,
          otpCode,
        });
        console.log(`✅ [AuthController] Verification email dispatched to ${cleanEmail} on signup.`);
      } catch (mailErr) {
        console.error('[AuthController] sendVerificationEmail error during signup:', mailErr.message);
      }
    }

    return res.status(201).json({
      success: true,
      message: `Account created successfully! Verification email sent to ${cleanEmail}. Please verify before logging in.`,
      requires_email_verification: true,
      data: {
        user: {
          id: userRecord?.id,
          email: userRecord?.email,
          full_name: userRecord?.user_metadata?.full_name,
          store_name: assignedStoreName,
          created_at: userRecord?.created_at,
          email_confirmed: false,
        },
        store: initialStore,
        session: null,
      },
    });
  } catch (err) {
    console.error('[AuthController] signup error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during signup.',
    });
  }
};

/**
 * @desc    Verify email address via token or 6-digit OTP
 * @route   POST /api/auth/verify-email
 * @route   GET /api/auth/verify-email?token=...
 * @access  Public
 */
const verifyEmail = async (req, res) => {
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8100';

  try {
    const token = req.query.token || req.body.token;
    const email = req.body.email || req.query.email;
    const otp = req.body.otp || req.query.otp;

    let targetEmail = email;
    let targetUserId = null;

    if (token) {
      const result = verifyToken(String(token).trim());
      if (!result.valid) {
        if (req.method === 'GET') {
          return res.redirect(`${FRONTEND_URL}/verify-email?error=invalid_token`);
        }
        return res.status(400).json({
          success: false,
          message: 'Verification link is invalid or has expired (24h limit). Please request a new one.',
          error: result.error,
        });
      }
      targetEmail = result.data.email;
      targetUserId = result.data.userId;
    } else if (email && otp) {
      targetEmail = String(email).trim().toLowerCase();
    } else {
      if (req.method === 'GET') {
        return res.redirect(`${FRONTEND_URL}/verify-email`);
      }
      return res.status(400).json({
        success: false,
        message: 'Verification token or email & OTP code is required.',
      });
    }

    // Confirm email in Supabase Auth
    let confirmedUser = null;
    if (targetUserId) {
      const { data, error } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
        email_confirm: true,
      });
      if (!error && data?.user) {
        confirmedUser = data.user;
      }
    }
    
    if (!confirmedUser && targetEmail) {
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
      const user = usersData?.users?.find((u) => u.email?.toLowerCase() === targetEmail.toLowerCase());
      if (user) {
        const { data, error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
          email_confirm: true,
        });
        if (!error && data?.user) {
          confirmedUser = data.user;
        }
      }
    }

    if (req.method === 'GET') {
      return res.redirect(
        `${FRONTEND_URL}/verify-email?verified=true&email=${encodeURIComponent(targetEmail || '')}`
      );
    }

    return res.status(200).json({
      success: true,
      message: '🎉 Email verified successfully! Your account and store are now fully active.',
      data: {
        email: targetEmail,
        verified: true,
      },
    });
  } catch (err) {
    console.error('[AuthController] verifyEmail error:', err.message);
    if (req.method === 'GET') {
      return res.redirect(`${FRONTEND_URL}/verify-email?error=server_error`);
    }
    return res.status(500).json({
      success: false,
      message: 'Internal server error during email verification.',
      error: err.message,
    });
  }
};

/**
 * @desc    Resend verification email
 * @route   POST /api/auth/resend-verification
 * @access  Public
 * @body    { email }
 */
const resendVerification = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email address is required.',
      });
    }

    const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
    const user = usersData?.users?.find((u) => u.email?.toLowerCase() === email.trim().toLowerCase());

    if (!user) {
      // Don't leak user non-existence
      return res.status(200).json({
        success: true,
        message: 'If an account exists with this email, a verification link has been resent.',
      });
    }

    const storeName = user.user_metadata?.store_name || user.user_metadata?.company || 'Your Store';
    const { token, otpCode } = generateVerificationToken(user, storeName);

    await sendVerificationEmail({
      name: user.user_metadata?.full_name || '',
      email: user.email,
      storeName,
      token,
      otpCode,
    });

    return res.status(200).json({
      success: true,
      message: `Verification instructions resent to ${email}. Please check your inbox.`,
    });
  } catch (err) {
    console.error('[AuthController] resendVerification error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to resend verification email.',
      error: err.message,
    });
  }
};

/**
 * @desc    Login existing user
 * @route   POST /api/auth/login
 * @access  Public
 * @body    { email, password }
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required.',
      });
    }

    // Sign in via Supabase Auth
    const { data, error } = await supabasePublic.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password.',
        });
      }
      if (error.message.includes('Email not confirmed')) {
        return res.status(403).json({
          success: false,
          requires_email_verification: true,
          message: 'Please verify your email address before logging in. Check your inbox for the verification email.',
        });
      }
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      data: {
        user: {
          id: data.user.id,
          email: data.user.email,
          full_name: data.user.user_metadata?.full_name,
          created_at: data.user.created_at,
          last_sign_in: data.user.last_sign_in_at,
        },
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at,
          token_type: data.session.token_type,
        },
      },
    });
  } catch (err) {
    console.error('[AuthController] login error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during login.',
    });
  }
};

/**
 * @desc    Logout user (invalidate session on Supabase side)
 * @route   POST /api/auth/logout
 * @access  Private (requires valid token)
 */
const logout = async (req, res) => {
  try {
    const token = req.token;
    const { error } = await supabaseAdmin.auth.admin.signOut(token);

    if (error) {
      console.warn('[AuthController] logout warning:', error.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully.',
    });
  } catch (err) {
    console.error('[AuthController] logout error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during logout.',
    });
  }
};

/**
 * @desc    Get current authenticated user profile
 * @route   GET /api/auth/me
 * @access  Private (requires valid token)
 */
const getMe = async (req, res) => {
  try {
    const user = req.user;

    return res.status(200).json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name,
        phone: user.phone,
        created_at: user.created_at,
        last_sign_in: user.last_sign_in_at,
        email_confirmed: user.email_confirmed_at ? true : false,
        role: user.role,
        app_metadata: user.app_metadata,
        user_metadata: user.user_metadata,
      },
    });
  } catch (err) {
    console.error('[AuthController] getMe error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while fetching user.',
    });
  }
};

/**
 * @desc    Refresh access token using refresh token
 * @route   POST /api/auth/refresh
 * @access  Public
 * @body    { refresh_token }
 */
const refreshToken = async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required.',
      });
    }

    const { data, error } = await supabasePublic.auth.refreshSession({
      refresh_token,
    });

    if (error || !data.session) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token. Please login again.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Token refreshed successfully.',
      data: {
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at,
          token_type: data.session.token_type,
        },
      },
    });
  } catch (err) {
    console.error('[AuthController] refreshToken error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during token refresh.',
    });
  }
};

/**
 * @desc    Send password reset email
 * @route   POST /api/auth/forgot-password
 * @access  Public
 * @body    { email }
 */
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required.',
      });
    }

    const { error } = await supabasePublic.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.FRONTEND_URL || 'http://localhost:8100'}/reset-password`,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.',
    });
  } catch (err) {
    console.error('[AuthController] forgotPassword error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during password reset request.',
    });
  }
};

/**
 * @desc    Update authenticated user password
 * @route   PUT /api/auth/update-password
 * @access  Private
 * @body    { new_password }
 */
const updatePassword = async (req, res) => {
  try {
    const { new_password } = req.body;

    if (!new_password) {
      return res.status(400).json({
        success: false,
        message: 'New password is required.',
      });
    }

    if (new_password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long.',
      });
    }

    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
      req.user.id,
      { password: new_password }
    );

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Password updated successfully.',
    });
  } catch (err) {
    console.error('[AuthController] updatePassword error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during password update.',
    });
  }
};

module.exports = {
  signup,
  verifyEmail,
  resendVerification,
  login,
  logout,
  getMe,
  refreshToken,
  forgotPassword,
  updatePassword,
};
