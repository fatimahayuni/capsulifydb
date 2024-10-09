// 1. SETUP EXPRESS
const express = require('express');
const cors = require('cors');
const { ObjectId } = require('mongodb');
const MongoClient = require('mongodb').MongoClient;
const dbname = "capsulify";
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(403);
    jwt.verify(token, process.env.TOKEN_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

const generateAccessToken = (id, email) => {
    return jwt.sign({
        'user_id': id,
        'email': email
    }, process.env.TOKEN_SECRET, {
        expiresIn: "1h"
    });
}

require('dotenv').config()

// set the mongoUri to be MONGO_URI from the .env file
// make sure to read data from process.env AFTER 'require('dotenv').config()
const mongoUri = process.env.MONGO_URI;

// 1a. create the app
const app = express();
app.use(cors());

// 1b. enable JSON processing (allow clients to send JSON data to our server)
app.use(express.json());

async function connect(uri, dbname) {
    let client = await MongoClient.connect(uri, {
        useUnifiedTopology: true
    })
    let db = client.db(dbname);
    return db;
}


async function main() {

    // connect to the mongo database here
    let db = await connect(mongoUri, dbname);

    // Check if the database is connected
    console.log("Database connected:", !!db);

    // Fetch and log existing combos
    const existingCombos = await db.collection("combos").find({}).toArray();
    console.log("Existing combos:", existingCombos.map(combo => combo.comboName));

    // 2. CREATE ROUTES
    app.get('/', function (req, res) {
        res.json({
            "message": "Hello World!"
        });
    });

    // There's a convention for RESTful API when it comes to writing the URL
    // The URL should function like a file path (always a resource, a noun)
    // Allow the user to search by name, comboName, top, bottom, shoes, bags.\\
    // eg
    // ?name=combo1
    // ?tags=smartcasual
    // ?tags=smartcasual
    // Get the combos by URL queries.
    app.get("/combinations", async function (req, res) {
        try {

            let { tags, combos, wardrobe } = req.query;

            let criteria = {};

            if (tags) {
                criteria["tags"] = {
                    "$in": tags.split(",").map(tag => tag.trim())
                };
            }

            // Check for combo names in the combos collection
            if (combos) {
                criteria["comboName"] = {
                    "$regex": combos, "$options": "i"
                }
            }

            // Check for wardrobe categories
            if (wardrobe) {
                // Split the wardrobe query into category and item
                const wardrobeQueries = wardrobe.split(",").map(item => item.trim());
                wardrobeQueries.forEach(item => {
                    const [category, itemValue] = item.split(":").map(i => i.trim()); // Assuming format "category:item1,item2"

                    // Check if category is valid and construct criteria
                    if (["bottom", "top", "dress", "shoes", "bag", "layer"].includes(category.toLowerCase())) {
                        criteria[category.toLowerCase()] = itemValue;
                    }
                });
            }

            console.log("Constructed criteria:", criteria);

            // Querying the combos collection
            let combinations = await db.collection("combos").find(criteria)
                .project({
                    "comboName": 1,
                    "top": 1,
                    "bottom": 1,
                    "shoes": 1,
                    "bag": 1,
                    "dress": 1,
                    'tags': 1
                }).toArray();

            console.log("Combinations found:", combinations);

            res.json({
                'combinations': combinations
            })

        } catch (error) {
            console.log("Error fetching combinations", error);
            res.status(500).send(error.message);
        }
    })

    // Get the details of the combo with _id
    app.get("/combinations/:id", async function (req, res) {
        try {
            // get the id of the recipe that we want to get full details of
            let id = req.params.id;

            // mongo shell: db.recipes.find({
            // _id: ObjectId(id)
            // })
            let combination = await db.collection('combos').findOne({
                "_id": new ObjectId(id)
            });

            if (!combination) {
                return res.status(404).json({
                    "error": "Sorry, combination not found"
                })
            }

            // Send back a response
            res.json({
                'combinations': combination
            })



        } catch (error) {
            console.log("Error fetching combinations: "), error;
            res.status(500);
        }
    })

    // Add new combo.
    app.post("/combinations", async function (req, res) {
        console.log("Incoming Request Body:", req.body);
        try {
            // user must add top, bottom, shoes, bag, tags, and layer.
            // when we use POST, PATCH, or PUT to send data to the server, the data are in req.body. 
            // Extract the data from the request body
            const { comboName, top, bottom, shoes, bag, tags, layer } = req.body;

            // Validate that all required fields are present
            if (!comboName || !top || !bottom || !shoes || !bag || !tags || !layer) {
                return res.status(400).json({
                    error: "All fields (name, top, bottom, shoes, bag, tags, layer) are required."
                });
            }

            // Create a new combination object
            const newCombination = {
                comboName: comboName,
                top: top,
                bottom: bottom,
                shoes: shoes,
                bag: bag,
                tags: Array.isArray(tags) ? tags.map(tag => tag.trim()) : [],
                layer: layer,
            };

            // Insert the new combination into the database
            const result = await db.collection("combos").insertOne(newCombination)

            // Respond with the created combination
            res.status(201).json({
                message: "New style created successfully",
                combination: {
                    _id: result.insertedId,
                    ...newCombination
                }
            });

        } catch (e) {
            console.error(e);
            res.status(500);
        }
    })

    // Update a combo based on ID
    app.put('/combinations/:id', async (req, res) => {
        try {
            const comboId = req.params.id;
            const { comboName, top, bottom, shoes, bag, tags, layer } = req.body;

            // Basic validation
            if (!comboName || !top || !bottom || !shoes || !bag || !layer) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            // fetch the combo document
            const comboDoc = await db.collection('combos').findOne({ comboName });
            if (!comboDoc) {
                return res.status(400).json({ error: 'Combo not found' })
            }

            // Fetch the tag document
            const tagDocs = await db.collection('tags').find({ name: { $in: tags } }).toArray();
            if (tagDocs.length !== tags.length) {
                return res.status(400).json({ error: 'One or more invalid tags' });
            }

            // Create the updated recipe object
            const updatedCombo = {
                comboName,
                top,
                bottom,
                shoes,
                bag,
                tags: tagDocs.map(tag => tag._id),
                layer
            };

            // update the combo in the database
            const result = await db.collection('combos').updateOne(
                { _id: new ObjectId(comboId) },
                { $set: updatedCombo }
            );

            // Check if the update was successful
            if (result.modifiedCount === 0) {
                return res.status(404).json({ error: "No changes made or combo not found " });
            }

            res.status(200).json({
                message: "Combo updated successfully",
                updatedcoMBO: {
                    _id: comboId,
                    ...updatedCombo
                }
            });

        } catch (error) {
            console.log("Error updating combo", error);
            res.status(500).json({ error: "Internal server erorr" })
        }
    })

    app.delete('/combinations/:id', async (req, res) => {
        try {
            const comboId = req.params.id;

            // Attempt to delete the recipe
            const result = await db.collection('combos').deleteOne({ _id: new ObjectId(comboId) });

            if (result.deletedCount === 0) {
                return res.status(404).json({ error: 'Combination not found' });
            }

            res.json({ message: 'Combination deleted successfully' });

        } catch (error) {
            console.error('Error deleting combination: ', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    })

    app.post('/users', async function (req, res) {
        const result = await db.collection("users").insertOne({
            'email': req.body.email,
            'password': await bcrypt.hash(req.body.password, 12)
        })
        res.json({
            "message": "New user account",
            "result": result
        })
    })

    app.post('/login', async (req, res) => {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }
        const user = await db.collection('users').findOne({ email: email });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid password' });
        }
        const accessToken = generateAccessToken(user._id, user.email);
        res.json({ accessToken: accessToken });
    });

    app.get('/profile', verifyToken, (req, res) => {
        res.json({ message: 'This is a protected route', user: req.user });
    });
}

// Call main before starting the server
main();



// 3. START SERVER (Don't put any routes after this line)
app.listen(3000, function () {
    console.log("Server has started");
})