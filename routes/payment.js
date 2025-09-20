const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Subscription = require('../models/Subscription');

// POST /api/payment/create-payment-intent
// Creates a Payment Intent with amount (in cents) for the total (price + tax)
router.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount } = req.body; // amount in cents, e.g., 3190 for $31.90 (29 + 10% tax)

    if (!amount) {
      return res.status(400).json({ error: 'Amount is required' });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: 'usd',
      automatic_payment_methods: {
        enabled: true,
      },
    });

    res.send({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (error) {
    res.status(400).send({ error: { error: error.message } });
  }
});

// POST /api/payment/record-payment
// Records the successful payment in MongoDB
router.post('/record-payment', async (req, res) => {
  try {
    const { email, planName, planPrice, paymentIntentId, billingAddress } = req.body;

    if (!email || !planName || !planPrice || !paymentIntentId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if subscription already exists for this email
    let existingSubscription = await Subscription.findOne({ email });
    if (existingSubscription) {
      return res.status(400).json({ error: 'Subscription already exists for this email' });
    }

    const newSubscription = new Subscription({
      email,
      planName,
      planPrice,
      stripePaymentIntentId: paymentIntentId,
      billingAddress
    });

    await newSubscription.save();

    res.json({ success: true, message: 'Payment recorded successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;