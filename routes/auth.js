const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { OAuth2Client } = require('google-auth-library');
const nodemailer = require('nodemailer'); // Correct import
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Nodemailer transporter setup (corrected to createTransport)
const transporter = nodemailer.createTransport({
  service: 'gmail', // Or 'sendgrid', 'mailgun', etc.
  auth: {
    user: process.env.EMAIL_USER, // e.g., yourgmail@gmail.com
    pass: process.env.EMAIL_PASS // e.g., your app password
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { firstName, lastName, email, password, confirmPassword } = req.body;

    if (!firstName || !lastName || !email || !password || !confirmPassword) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Create new user
    const user = new User({ firstName, lastName, email, password });
    await user.save();

    // Generate JWT
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ 
      success: true, 
      token, 
      user: { id: user._id, firstName: user.firstName, lastName: user.lastName, email: user.email } 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password only if it exists
    if (user.password) {
      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    } else {
      return res.status(401).json({ error: 'This account uses Google authentication. Please use Google sign-in.' });
    }

    // Generate JWT
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({ 
      success: true, 
      token, 
      user: { id: user._id, firstName: user.firstName, lastName: user.lastName, email: user.email } 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/auth/google
router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ error: 'ID token is required' });
    }

    // Verify Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { email, given_name: firstName = '', family_name: lastName = '', sub: googleId } = payload;

    if (!email) {
      return res.status(400).json({ error: 'Invalid Google token' });
    }

    // Find or create user
    let user = await User.findOne({ email });
    if (!user) {
      // Create new user with Google ID (no password)
      user = new User({ 
        firstName, 
        lastName, 
        email, 
        googleId,
        password: null
      });
      await user.save();
    } else if (user.googleId && user.googleId !== googleId) {
      return res.status(400).json({ error: 'Account linked to a different Google account' });
    } else if (!user.googleId) {
      // Existing user with email/password, link Google account
      user.googleId = googleId;
      await user.save();
    }

    // Generate JWT
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({ 
      success: true, 
      token, 
      user: { id: user._id, firstName: user.firstName, lastName: user.lastName, email: user.email } 
    });
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({ error: 'Google authentication failed' });
  }
});

// POST /api/auth/forgot-password - Send OTP to email
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Set OTP and expiry (10 minutes)
    user.otp = otp;
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 min expiry
    await user.save();

    // Send email with OTP
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'PixelLift Password Reset OTP',
      html: `
        <h2>Password Reset OTP</h2>
        <p>Your OTP for password reset is: <strong>${otp}</strong></p>
        <p>This OTP expires in 10 minutes.</p>
        <p>If you didn't request this, ignore this email.</p>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ OTP sent to:', email);

    res.json({ success: true, message: 'OTP sent to your email' });
  } catch (error) {
    console.error('❌ Forgot password error:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// POST /api/auth/reset-password - Verify OTP and update password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword, confirmPassword } = req.body;

    if (!email || !otp || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check OTP validity
    if (!user.otp || user.otp !== otp) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    if (user.otpExpiry < new Date()) {
      return res.status(400).json({ error: 'OTP expired' });
    }

    // Update password
    user.password = newPassword;
    user.otp = null;
    user.otpExpiry = null;
    await user.save();

    // Generate new JWT
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({ 
      success: true, 
      token, 
      user: { id: user._id, firstName: user.firstName, lastName: user.lastName, email: user.email } 
    });
  } catch (error) {
    console.error('❌ Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;