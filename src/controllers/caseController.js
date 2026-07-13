const prisma = require('../config/db');

const getActiveCases = async (req, res) => {
  try {
    const activeCases = await prisma.client.findMany({
      where: {
        status: {
          notIn: ['Closed', 'Refused']
        }
      },
      include: {
        assignedTo: { select: { fullName: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    const mapped = activeCases.map(c => ({
      ...c,
      name: `${c.firstName} ${c.lastName}`,
      assignedConsultantName: c.assignedTo?.fullName
    }));
    
    res.json(mapped);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching active cases' });
  }
};

const getClosedCases = async (req, res) => {
  try {
    const closedCases = await prisma.client.findMany({
      where: {
        status: {
          in: ['Closed', 'Refused']
        }
      },
      include: {
        assignedTo: { select: { fullName: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    const mapped = closedCases.map(c => ({
      ...c,
      name: `${c.firstName} ${c.lastName}`,
      assignedConsultantName: c.assignedTo?.fullName
    }));
    
    res.json(mapped);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching closed cases' });
  }
};

module.exports = { getActiveCases, getClosedCases };
