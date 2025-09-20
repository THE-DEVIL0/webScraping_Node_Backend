const express = require("express");
const router = express.Router();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Subscription = require("../models/Subscription");
const User = require("../models/User"); // ✅ Import User model

// POST /api/payment/create-payment-intent
router.post("/create-payment-intent", async (req, res) => {
  try {
    const { amount } = req.body; // amount in cents

    if (!amount) {
      return res.status(400).json({ error: "Amount is required" });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: "usd",
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
router.post("/record-payment", async (req, res) => {
  try {
    const { email, planName, planPrice, paymentIntentId, billingAddress } =
      req.body;

    if (!email || !planName || !planPrice || !paymentIntentId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Check if subscription already exists for this email
    let existingSubscription = await Subscription.findOne({ email, planName });
    if (existingSubscription) {
      return res
        .status(400)
        .json({ error: "Subscription already exists for this email" });
    }
    await Subscription.deleteMany({ email });
    // Create subscription
    const newSubscription = new Subscription({
      email,
      planName,
      planPrice,
      stripePaymentIntentId: paymentIntentId,
      billingAddress,
    });

    await newSubscription.save();

    // ✅ Update user's subscriptionId
    const updatedUser = await User.findOneAndUpdate(
      { email },
      { subscriptionId: newSubscription._id },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ error: "User not found for this email" });
    }
    const update = await updatedUser.populate(
      "subscriptionId",
      "planName planPrice status"
    );
    res.json({
      success: true,
      message: "Payment recorded and user updated successfully",
      subscription: newSubscription,
      user: {
        id: update._id,
        firstName: update.firstName,
        lastName: update.lastName,
        email: update.email,
        planName: update.subscriptionId.planName,
        planStatus: update.subscriptionId.status,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
