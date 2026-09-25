const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

async function login(req, res) {

    try {

        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required"
            });
        }

        const result = await pool.query(
            `SELECT
                id,
                full_name,
                email,
                password_hash,
                role,
                is_active
             FROM users
             WHERE LOWER(email) = LOWER($1)`,
            [email]
        );

        if (!result.rows.length) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        const user = result.rows[0];

        if (!user.is_active) {
            return res.status(403).json({
                success: false,
                message: "Account is inactive"
            });
        }

        const valid = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!valid) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        const token = jwt.sign(
            {
                id: user.id,
                email: user.email,
                role: user.role
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "8h"
            }
        );

        res.json({
            success: true,
            message: "Login successful",
            token,
            user: {
                id: user.id,
                name: user.full_name,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Login failed"
        });
    }
}

async function register(req, res) {

    try {

        const {
            full_name,
            email,
            password,
            role = "admin"
        } = req.body;

        if (!full_name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: "Required fields are missing"
            });
        }

        const existing = await pool.query(
            `SELECT id
             FROM users
             WHERE LOWER(email) = LOWER($1)`,
            [email]
        );

        if (existing.rows.length) {
            return res.status(409).json({
                success: false,
                message: "Email already exists"
            });
        }

        const hash = await bcrypt.hash(password, 12);

        const result = await pool.query(
            `INSERT INTO users
            (full_name, email, password_hash, role)
            VALUES ($1,$2,$3,$4)
            RETURNING id, full_name, email, role`,
            [
                full_name,
                email,
                hash,
                role
            ]
        );

        res.status(201).json({
            success: true,
            message: "User created",
            user: result.rows[0]
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Registration failed"
        });
    }
}

module.exports = {
    login,
    register
};