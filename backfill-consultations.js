const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const leads = await prisma.lead.findMany({
    where: { 
      meetingPreferredDate: { not: null },
      assignedToId: { not: null },
      status: 'Form Submitted'
    },
    include: { consultations: true }
  });

  for (const lead of leads) {
    if (lead.consultations.length === 0 && lead.meetingPreferredDate) {
      console.log(`Creating consultation for lead: ${lead.firstName}`);
      await prisma.consultation.create({
        data: {
          date: lead.meetingPreferredDate,
          timeSlot: lead.meetingPreferredTime || 'TBD',
          durationMinutes: 30,
          status: 'Pending Acceptance',
          leadId: lead.id,
          consultantId: lead.assignedToId,
          internalNotes: lead.meetingNotes || ''
        }
      });
    }
  }
  console.log("Backfill complete!");
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
