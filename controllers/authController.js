// authController.js - Authentication (Signup & Login)

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");
const { JWT_SECRET } = require("../config/constants");
const { convertDateFormat } = require("../utils/helpers");

// Signup Controller
const signup = async (req, res) => {
  const {
    role,
    fullName,
    email,
    phoneNumber,
    password,
    gender,
    dateOfBirth,
    address,
    aadharNumber,
    licenseNumber,
    scooterModel,
    profilePhoto,
  } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 12);
    const mysqlDate = convertDateFormat(dateOfBirth);

    if (role === "Consumer") {
      // Check for existing consumer
      const checkQuery =
        "SELECT * FROM consumers WHERE email = $1 OR phone = $2 OR aadhar_number = $3";
      
      const checkResult = await db.query(checkQuery, [email, phoneNumber, aadharNumber]);
      
      if (checkResult.rows.length > 0) {
        const existingField =
          checkResult.rows[0].email === email
            ? "email"
            : checkResult.rows[0].phone === phoneNumber
            ? "phone number"
            : "Aadhar number";
        return res
          .status(400)
          .json({ error: `This ${existingField} is already registered` });
      }

      // Insert new consumer
      const query = `
        INSERT INTO consumers 
        (full_name, email, phone, password, gender, date_of_birth, address, aadhar_number, profile_photo)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `;
      
      const result = await db.query(query, [
        fullName,
        email,
        phoneNumber,
        hashedPassword,
        gender,
        mysqlDate,
        address,
        aadharNumber,
        profilePhoto,
      ]);
      
      res.status(201).json({
        message: "Consumer registered successfully!",
        userId: result.rows[0].id,
      });
      
    } else if (role === "Driver") {
      // Check for existing driver
      const checkQuery =
        "SELECT * FROM drivers WHERE email = $1 OR phone = $2 OR aadhar_number = $3 OR license_number = $4";
      
      const checkResult = await db.query(checkQuery, [email, phoneNumber, aadharNumber, licenseNumber]);
      
      if (checkResult.rows.length > 0) {
        const existingField =
          checkResult.rows[0].email === email
            ? "email"
            : checkResult.rows[0].phone === phoneNumber
            ? "phone number"
            : checkResult.rows[0].aadhar_number === aadharNumber
            ? "Aadhar number"
            : "license number";
        return res
          .status(400)
          .json({ error: `This ${existingField} is already registered` });
      }

      // Insert new driver
      const query = `
        INSERT INTO drivers
        (full_name, email, phone, password, gender, date_of_birth, address, aadhar_number, license_number, scooter_model, profile_photo)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
      `;
      
      const result = await db.query(query, [
        fullName,
        email,
        phoneNumber,
        hashedPassword,
        gender,
        mysqlDate,
        address,
        aadharNumber,
        licenseNumber,
        scooterModel,
        profilePhoto,
      ]);
      
      res.status(201).json({
        message: "Driver registered successfully!",
        userId: result.rows[0].id,
      });
      
    } else {
      res.status(400).json({ error: "Invalid role" });
    }
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Login Controller
const login = async (req, res) => {
  const { role, email, password } = req.body;

  if (!role || !["Consumer", "Driver"].includes(role)) {
    return res.status(400).json({ error: "Invalid role specified" });
  }
  if (!email || !password) {
    return res
      .status(400)
      .json({ error: "Email/phone and password are required" });
  }

  try {
    const table = role === "Consumer" ? "consumers" : "drivers";
    const query = `SELECT * FROM ${table} WHERE email = $1 OR phone = $2`;

    const result = await db.query(query, [email, email]);
    
    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Account not found" });
    }

    const user = result.rows[0];
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid password" });
    }

    const token = jwt.sign({ id: user.id, role }, JWT_SECRET, {
      expiresIn: "7d",
    });

    const safeUser =
      role === "Driver"
        ? {
            id: user.id,
            fullName: user.full_name,
            email: user.email,
            phone: user.phone,
            gender: user.gender,
            dateOfBirth: user.date_of_birth,
            address: user.address,
            aadharNumber: user.aadhar_number,
            licenseNumber: user.license_number,
            scooterModel: user.scooter_model,
            profilePhoto: user.profile_photo,
            isAvailable: user.is_available,
            role,
          }
        : {
            id: user.id,
            fullName: user.full_name,
            email: user.email,
            phone: user.phone,
            gender: user.gender,
            dateOfBirth: user.date_of_birth,
            address: user.address,
            aadharNumber: user.aadhar_number,
            profilePhoto: user.profile_photo,
            role,
          };

    res.json({
      message: "Login successful",
      token,
      user: safeUser,
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Login failed. Try again." });
  }
};

module.exports = {
  signup,
  login,
};
