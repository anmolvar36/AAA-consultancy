const bcrypt = require('bcrypt');
const prisma = require('../config/db');

// @desc    Get all users (agents)
// @route   GET /api/v1/users/agents
// @access  Private (Admin/Super Admin)
const getAgents = async (req, res) => {
  try {
    let whereClause = {};
    if (req.user && req.user.role === 'admin') {
      whereClause = {
        OR: [
          { createdById: req.user.id },
          { id: req.user.id }
        ]
      };
    } else if (req.user && req.user.role !== 'super_admin' && req.user.role !== 'admin') {
      whereClause = { id: req.user.id }; // Other roles only see themselves if they hit this route
    }

    const agents = await prisma.user.findMany({
      where: whereClause,
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        hotlineNumber: true,
        spokenLanguages: true,
        nationalities: true,
        commissionRate: true,
        immigrationBio: true,
        customPermissions: true,
        avatar: true,
        createdAt: true
      }
    });
    // Add virtual fields for frontend mapping
    const mappedAgents = agents.map(a => ({
      ...a,
      name: a.fullName,
      phone: a.hotlineNumber,
      languages: a.spokenLanguages,
      bio: a.immigrationBio,
      casesCount: 0,
      avatar: a.avatar || null
    }));
    res.json(mappedAgents);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Create new user (agent)
// @route   POST /api/v1/users
// @access  Private (Super Admin)
const createUser = async (req, res) => {
  try {
    const {
      fullName, email, password, hotlineNumber, role,
      spokenLanguages, nationalities, commissionRate, immigrationBio, customPermissions
    } = req.body;

    const userExists = await prisma.user.findUnique({ where: { email } });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await prisma.user.create({
      data: {
        fullName,
        email,
        password: hashedPassword,
        hotlineNumber,
        role: role || 'consultant',
        spokenLanguages,
        nationalities,
        commissionRate: Number(commissionRate) || 0,
        immigrationBio,
        customPermissions,
        createdById: req.user ? req.user.id : null
      }
    });

    res.status(201).json({
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      fullName, email, hotlineNumber, role,
      spokenLanguages, nationalities, commissionRate, immigrationBio, customPermissions
    } = req.body;

    const user = await prisma.user.update({
      where: { id },
      data: {
        fullName,
        email,
        hotlineNumber,
        role,
        spokenLanguages,
        nationalities,
        commissionRate: Number(commissionRate) || 0,
        immigrationBio,
        customPermissions
      }
    });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.user.delete({ where: { id } });
    res.json({ message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

const resetUserPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({
      where: { id },
      data: { password: hashedPassword }
    });
    res.json({ message: 'Password updated' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { getAgents, createUser, updateUser, deleteUser, resetUserPassword };
