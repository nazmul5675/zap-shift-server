const express = require('express')
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SEC);
const port = process.env.PORT || 3000
const crypto = require('crypto');


const admin = require("firebase-admin");

// const serviceAccount = require("./ZapShiftAdminSDK.json");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

function generateTrackingId() {
    const prefix = 'zap';
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const random = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `${prefix}-${date}-${random}`;
}
//middleware
app.use(express.json());
app.use(cors());
const verifyFBToken = async (req, res, next) => {
    // console.log('header', req.headers.authorization);
    const token = req.headers.authorization;
    if (!token) {
        return res.status(401).send({ message: 'unauthorized access' })
    }
    try {
        const idToken = token.split(' ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.decoded_email = decodedToken.email;
        // console.log('decoded token', decodedToken);
        next();
    }
    catch (error) {
        return res.status(401).send({ message: 'unauthorized access' })
    }

}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.l8gdu91.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // await client.connect();
        const db = client.db('zap_shift_DB');
        const usersCollection = db.collection('users')
        const parcelsCollection = db.collection('parcels')
        const paymentCollection = db.collection('payments')
        const ridersCollection = db.collection('riders');
        const trackingsCollection = db.collection('trackings');

        //middleware admin before allowing admin activity
        //must be used after verifyFBToken middleware
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded_email;
            const query = { email };
            const user = await usersCollection.findOne(query)
            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();
        }
        const verifyRider = async (req, res, next) => {
            const email = req.decoded_email;
            const query = { email };
            const user = await usersCollection.findOne(query)
            if (!user || user.role !== 'rider') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();
        }

        const logTracking = async (trackingId, status) => {
            const lastLog = await trackingsCollection.findOne(
                { trackingId },
                { sort: { createdAt: -1 } }
            );

            // Prevent duplicate status logs
            if (lastLog && lastLog.status === status) {
                return { message: "Duplicate log avoided", skipped: true };
            }
            const log = {
                trackingId,
                status,
                details: status.split('-').join(' '),
                createdAt: new Date()
            }
            const result = await trackingsCollection.insertOne(log);
            return result
        }

        // users related apis
        app.get('/users', verifyFBToken, async (req, res) => {
            const searchText = req.query.searchText;
            const query = {}
            if (searchText) {
                // query.displayName = { $regex: searchText, $options: 'i' };
                query.$or = [
                    { displayName: { $regex: searchText, $options: 'i' } },
                    { email: { $regex: searchText, $options: 'i' } }
                ]
            }

            const cursor = usersCollection.find(query).sort({ createdAt: -1 }).limit(5);
            const result = await cursor.toArray();
            res.send(result);
        })
        app.get('/users/:id', async (req, res) => {

        })
        app.get('/users/:email/role', async (req, res) => {
            const email = req.params.email;
            const query = { email };
            const user = await usersCollection.findOne(query);
            res.send({ role: user?.role || 'user' });
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            user.role = 'user';
            user.createdAt = new Date();
            const email = user.email;
            const userExists = await usersCollection.findOne({ email })
            if (userExists) {
                return res.send({ message: 'User already exists' })
            }
            const result = await usersCollection.insertOne(user);
            res.send(result);

        })

        app.patch('/users/:id/role', verifyFBToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const roleInfo = req.body;
            const query = { _id: new ObjectId(id) };
            const update = {
                $set: {
                    role: roleInfo.role
                }
            }
            const result = await usersCollection.updateOne(query, update);
            res.send(result);
        })

        //parcel API
        app.get('/parcels', async (req, res) => {
            const query = {};
            const { email, deliveryStatus } = req.query;

            if (email) {
                query.senderEmail = email;
            }
            if (deliveryStatus) {
                query.deliveryStatus = deliveryStatus;
            }

            const options = { sort: { createdAt: -1 } }

            const cursor = parcelsCollection.find(query, options);
            const result = await cursor.toArray();
            res.send(result);

        })


        app.get('/parcels/rider', async (req, res) => {
            const { riderEmail, deliveryStatus } = req.query;
            const query = {}
            if (riderEmail) {
                query.riderEmail = riderEmail;
            }
            if (deliveryStatus !== 'parcel-delivered') {
                // query.deliveryStatus = { $in: ['driver-assigned', 'rider-arriving'] };
                query.deliveryStatus = { $nin: ['parcel-delivered'] };
            }
            else {
                query.deliveryStatus = deliveryStatus;
            }
            const cursor = parcelsCollection.find(query);
            const result = await cursor.toArray();
            res.send(result);
        })
        app.get('/parcels/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await parcelsCollection.findOne(query);
            res.send(result);
        })

        app.get('/parcels/delivery-status/stats', async (req, res) => {
            const pipeline = [
                {
                    $match: {
                        deliveryStatus: { $ne: null }
                    }
                },
                {
                    $group: {
                        _id: '$deliveryStatus',
                        count: { $sum: 1 },
                    }

                },
                {
                    $project: {
                        status: '$_id',
                        count: 1
                    }
                }
            ]
            const result = await parcelsCollection.aggregate(pipeline).toArray()
            res.send(result)
        })

        app.post('/parcels', async (req, res) => {
            const parcel = req.body;
            const trackingId = generateTrackingId();
            // parcel created at time
            parcel.createdAt = new Date();
            parcel.trackingId = trackingId;
            logTracking(trackingId, 'parcel-created')
            const result = await parcelsCollection.insertOne(parcel);
            res.send(result);
        })
        // tod0: rename this to be specific like /parcel/:id/assign
        app.patch('/parcels/:id', async (req, res) => {
            const { riderId, riderName, riderEmail, trackingId } = req.body;
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };

            const updateDoc = {
                $set: {
                    deliveryStatus: 'driver-assigned',
                    riderId: riderId,
                    riderName: riderName,
                    riderEmail: riderEmail
                }
            }
            const result = await parcelsCollection.updateOne(query, updateDoc)
            // update rider information
            const riderQuery = { _id: new ObjectId(riderId) }
            const riderUpdatedDoc = {
                $set: {
                    workStatus: 'in_Delivery'
                }
            }
            const riderResult = await ridersCollection.updateOne(riderQuery, riderUpdatedDoc)
            // log tracking
            logTracking(trackingId, 'driver-assigned')
            res.send(riderResult)
        })

        // for rider who accept the assign job
        app.patch('/parcels/:id/status', async (req, res) => {
            const { deliveryStatus, riderId, trackingId } = req.body;
            const query = { _id: new ObjectId(req.params.id) }
            const updateDoc = {
                $set: {
                    deliveryStatus: deliveryStatus
                }
            }
            if (deliveryStatus === 'parcel-delivered') {
                // update rider information
                const riderQuery = { _id: new ObjectId(riderId) }
                const riderUpdatedDoc = {
                    $set: {
                        workStatus: 'available'
                    }
                }
                const riderResult = await ridersCollection.updateOne(riderQuery, riderUpdatedDoc)


            }
            const result = await parcelsCollection.updateOne(query, updateDoc);
            // log tracking
            logTracking(trackingId, deliveryStatus)
            res.send(result)

        })
        // rejected by rider so it get to the previous state
        app.patch('/parcel/:id/reject', async (req, res) => {
            const { riderId } = req.body;
            const id = req.params.id;
            const parcelQuery = { _id: new ObjectId(id) };
            const parcelUpdate = {
                $set: {
                    deliveryStatus: 'pending-pickup',
                    riderId: null,
                    riderName: null,
                    riderEmail: null
                }
            }
            const parcelResult = await parcelsCollection.updateOne(parcelQuery, parcelUpdate)

            const riderQuery = { _id: new ObjectId(riderId) };
            const riderUpdate = {
                $set: {
                    workStatus: 'available'
                }
            }
            const riderResult = await ridersCollection.updateOne(riderQuery, riderUpdate)
            res.send(riderResult)

        })

        app.delete('/parcels/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await parcelsCollection.deleteOne(query);
            res.send(result);
        })

        // payment related API
        app.get('/payments', verifyFBToken, async (req, res) => {
            const email = req.query.email;
            const query = {};
            // console.log(req.headers);
            if (email) {
                query.customerEmail = email;
                // check email address/
                if (email !== req.decoded_email) {
                    return res.status(403).send({ message: 'forbidden access' })
                }

            }
            const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
            const result = await cursor.toArray();
            res.send(result)
        })

        app.post('/paymentCheckoutSession', async (req, res) => {

            const paymentInfo = req.body;
            const amount = parseInt(paymentInfo.cost) * 100;
            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {

                        price_data: {
                            currency: 'USD',
                            unit_amount: amount,
                            product_data: {
                                name: `Please Pay For : ${paymentInfo.parcelName}`
                            },
                        },
                        quantity: 1,
                    },
                ],
                mode: 'payment',
                metadata: {
                    parcelId: paymentInfo.parcelId,
                    parcelName: paymentInfo.parcelName,
                    trackingId: paymentInfo.trackingId
                },
                customer_email: paymentInfo.senderEmail,
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
            })
            res.send({ url: session.url });
        })

        // old
        // app.post('/create-checkout-session', async (req, res) => {
        //     const paymentInfo = req.body;
        //     const amount = parseInt(paymentInfo.cost) * 100;
        //     const session = await stripe.checkout.sessions.create({
        //         line_items: [
        //             {
        //                 price_data: {
        //                     currency: 'USD',
        //                     product_data: {
        //                         name: `Parcel Payment for ${paymentInfo.parcelName}`,
        //                     },
        //                     unit_amount: amount,
        //                 },

        //                 quantity: 1,
        //             },
        //         ],
        //         customer_email: paymentInfo.senderEmail,

        //         mode: 'payment',
        //         metadata: {
        //             parcelId: paymentInfo.parcelId,
        //         },
        //         success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
        //         cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        //     })
        //     console.log(session);
        //     res.send({ url: session.url });
        // })

        app.patch('/payment-success', async (req, res) => {
            const sessionId = req.query.session_id;
            const session = await stripe.checkout.sessions.retrieve(sessionId)
            // console.log(session);

            const transactionId = session.payment_intent;
            const query = { transactionId: transactionId }

            const paymentExist = await paymentCollection.findOne(query)
            // console.log(paymentExist);
            if (paymentExist) {
                return res.send({
                    message: 'Already existed', transactionId,
                    trackingId: paymentExist.trackingId
                })
            }
            // use previous tracking id created during the parcel create which was set to the session metadata during session created

            const trackingId = session.metadata.trackingId;
            if (session.payment_status === 'paid') {
                const id = session.metadata.parcelId;
                const query = { _id: new ObjectId(id) }
                const update = {
                    $set: {
                        paymentStatus: 'paid',
                        deliveryStatus: 'pending-pickup'

                    }
                };
                const result = await parcelsCollection.updateOne(query, update);

                const payment = {
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    customerEmail: session.customer_email,
                    parcelId: session.metadata.parcelId,
                    parcelName: session.metadata.parcelName,
                    transactionId: session.payment_intent,
                    paymentStatus: session.payment_status,
                    paidAt: new Date(),
                    trackingId: trackingId

                }

                const resultPayment = await paymentCollection.insertOne(payment)
                logTracking(trackingId, 'pending-pickup')

                return res.send({
                    success: true,
                    modifyParcel: result,
                    trackingId: trackingId,
                    transactionId: session.payment_intent,
                    paymentInfo: resultPayment
                })
            }

            return res.send({ success: false })
        })
        // riders related api 
        app.post('/riders', async (req, res) => {
            const rider = req.body;
            rider.status = 'pending';
            rider.createdAt = new Date();
            const result = await ridersCollection.insertOne(rider)
            res.send(result)
        })
        app.get('/riders', async (req, res) => {
            const { status, district, workStatus } = req.query;
            const query = {};
            if (status) {
                query.status = status;
            }
            if (district) {
                query.riderDistrict = district;
            }
            if (workStatus) {
                query.workStatus = workStatus;
            }
            // console.log(query);
            const cursor = ridersCollection.find(query);
            const result = await cursor.toArray();
            res.send(result);
        })

        app.get('/riders/delivery-per-day', async (req, res) => {
            const email = req.query.email;
            // aggregate on parcel
            const pipeline = [
                {
                    $match: {
                        riderEmail: email,
                        deliveryStatus: 'parcel-delivered'
                    }
                },
                {
                    $lookup: {
                        from: 'trackings',
                        localField: 'trackingId',
                        foreignField: 'trackingId',
                        as: 'parcel-tracking'
                    }
                },
                {
                    $unwind: '$parcel-tracking'
                },
                {
                    $match: {
                        'parcel-tracking.status': "parcel-delivered"
                    }
                },
                {
                    $group: {
                        _id: {
                            $dateToString: {
                                format: "%Y-%m-%d",
                                date: '$parcel-tracking.createdAt'
                            }
                        },
                        totalDelivered: { $sum: 1 }
                    }
                }
            ]
            const result = await parcelsCollection.aggregate(pipeline).toArray();
            res.send(result)
        })

        app.patch('/riders/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const status = req.body.status;
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const updatedDoc = {
                $set: {
                    status: status,
                    workStatus: 'available'
                }
            }

            const result = await ridersCollection.updateOne(query, updatedDoc);

            if (status === 'approved') {
                const email = req.body.riderEmail;
                const userQuery = { email }
                const updateUser = {
                    $set: {
                        role: 'rider'
                    }
                }
                const userResult = await usersCollection.updateOne(userQuery, updateUser);
            }

            res.send(result);
        })
        app.delete('/riders/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await ridersCollection.deleteOne(query);
            res.send(result);
        })


        // tracking related api
        app.get('/trackings/:trackingId/logs', async (req, res) => {
            const trackingId = req.params.trackingId;
            const query = { trackingId }
            const result = await trackingsCollection.find(query).toArray();
            res.send(result)
        })

        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('zap is shifting shifting!')
})

// app.listen(port, () => {
//     console.log(`Example app listening on port ${port}`)
// })


// app.listen(port, () => {
//     console.log(`Example app listening on port ${port}`)
// })
module.exports = app;  
