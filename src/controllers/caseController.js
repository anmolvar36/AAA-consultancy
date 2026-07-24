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
        assignedTo: { select: { fullName: true } },
        applicationCycles: true
      },
      orderBy: { createdAt: 'desc' }
    });
    
    const mapped = activeCases.map(c => ({
      ...c,
      onboardingDate: c.createdAt,
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
        assignedTo: { select: { fullName: true } },
        applicationCycles: true
      },
      orderBy: { createdAt: 'desc' }
    });
    
    const mapped = closedCases.map(c => ({
      ...c,
      onboardingDate: c.createdAt,
      name: `${c.firstName} ${c.lastName}`,
      assignedConsultantName: c.assignedTo?.fullName
    }));
    
    res.json(mapped);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching closed cases' });
  }
};

const getCyclesByClient = async (req, res) => {
  try {
    const { clientId } = req.params;
    const cycles = await prisma.applicationCycle.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' }
    });
    res.json(cycles);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching application cycles' });
  }
};

const createCycle = async (req, res) => {
  try {
    const { clientId, type, refusalReason, refusalDate, lawyerAssigned, appealDeadline, serviceType } = req.body;

    if (!clientId) {
      return res.status(400).json({ message: 'clientId is required' });
    }

    const isAppeal = type === 'appeal';
    const status = isAppeal ? 'Appeal Submitted' : 'Resubmission in Progress';

    const cycle = await prisma.applicationCycle.create({
      data: {
        clientId,
        type: type || 'resubmission',
        status,
        serviceType: serviceType || 'Resubmission / Appeal',
        refusalReason,
        refusalDate: refusalDate ? new Date(refusalDate) : null,
        lawyerAssigned,
        appealDeadline: appealDeadline ? new Date(appealDeadline) : null,
        resubmissionDate: new Date()
      }
    });

    // Update client visa status to Refused / In Appeal
    await prisma.client.update({
      where: { id: clientId },
      data: {
        visaStatus: isAppeal ? 'Under Appeal' : 'Resubmission in Progress',
        status: 'Refused'
      }
    });

    res.status(201).json(cycle);
  } catch (error) {
    console.error('Error creating application cycle:', error);
    res.status(500).json({ message: 'Server error creating application cycle', error: error.message });
  }
};

const updateCycle = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, lawyerAssigned, refusalReason, appealDeadline, appealDocuments } = req.body;

    const cycle = await prisma.applicationCycle.update({
      where: { id },
      data: {
        status,
        lawyerAssigned,
        refusalReason,
        appealDeadline: appealDeadline ? new Date(appealDeadline) : undefined,
        appealDocuments: appealDocuments || undefined
      }
    });

    res.json(cycle);
  } catch (error) {
    res.status(500).json({ message: 'Server error updating application cycle' });
  }
};

module.exports = {
  getActiveCases,
  getClosedCases,
  getCyclesByClient,
  createCycle,
  updateCycle
};
