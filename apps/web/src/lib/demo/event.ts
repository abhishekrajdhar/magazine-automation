/**
 * Demo event: National eGovernance Summit 2026.
 *
 * Every person, organisation, quotation and statistic below is FICTIONAL and
 * exists only to demonstrate the workflow. The UI labels all of it as
 * simulated demo data.
 */
import type { EventSession, ExtractedFact, Speaker, TranscriptSegment, VideoSource } from "@/lib/domain/types";

export const DEMO_PROJECT_ID = "prj_negs26";
const P = DEMO_PROJECT_ID;

type SpeakerSeed = [id: string, name: string, designation: string, organisation: string, verification: Speaker["verification"], videos: string[], bio: string];

const speakerSeeds: SpeakerSeed[] = [
  ["sp01", "Dr. Meera Raghavan", "Secretary", "Department of Digital Services", "confirmed", ["v01"], "A career civil servant who has led citizen-service platforms for over a decade, with a focus on assisted digital delivery."],
  ["sp02", "Anil Varma", "Summit Chair", "Elets Advisory Council", "confirmed", ["v01"], "Chairs the summit's advisory council and moderates its inaugural session."],
  ["sp03", "Sunita Deshmukh", "Mission Director", "State e-Governance Mission", "confirmed", ["v01"], "Leads a state programme that has moved more than two hundred services online since 2023."],
  ["sp04", "Vikram Sethi", "Senior Editor", "eGov Magazine", "confirmed", ["v02"], "Covers public-sector technology and moderates the summit's AI track."],
  ["sp05", "Dr. Farah Siddiqui", "Director", "National AI Programme Office", "confirmed", ["v02"], "Oversees funding and standards for AI pilots across government departments."],
  ["sp06", "Prakash Nair", "Chief Technology Officer", "Kaveri Systems", "confirmed", ["v02"], "Leads engineering at a GovTech firm building grievance and case-management platforms."],
  ["sp07", "Harpreet Gill", "Advisor, Public Sector AI", "Northwind Cloud India", "unverified", ["v02"], "Advises public institutions on responsible AI adoption and language technologies."],
  ["sp08", "Ashok Rao", "Director General", "State Cyber Coordination Centre", "confirmed", ["v03"], "Heads a coordination centre that responds to incidents across state departments."],
  ["sp09", "Nandini Joshi", "Chief Information Security Officer", "Sahyadri Data Systems", "confirmed", ["v03"], "Runs security for a data-centre operator serving government clients."],
  ["sp10", "Imran Shaikh", "Principal Consultant", "Trident Secure", "ai_suggested", ["v03"], "Security consultant specialising in recovery planning and resilience testing."],
  ["sp11", "Kirti Malhotra", "Chief Executive Officer", "City Smart Services Company", "confirmed", ["v04"], "Leads a city company running an integrated command centre and civic-service apps."],
  ["sp12", "Rohan Mehta", "Partner", "Urban Futures Advisory", "confirmed", ["v04"], "Advises municipal bodies on data-driven service design."],
  ["sp13", "Dr. Lakshmi Venkatesh", "Chief Executive Officer", "State Health Digital Mission", "confirmed", ["v05"], "Leads a state mission linking health IDs to records across public and private facilities."],
  ["sp14", "Dr. Arvind Kulkarni", "Director, Public Health Informatics", "Institute of Health Systems", "confirmed", ["v05"], "Researches interoperability standards and data quality in public health systems."],
  ["sp15", "Pooja Agarwal", "Vice President, Healthcare", "Medisync Technologies", "confirmed", ["v05"], "Builds integration products used by clinics and diagnostic chains."],
  ["sp16", "S. Balasubramanian", "Principal Secretary, IT & Electronics", "State Government", "confirmed", ["v06"], "Responsible for the state data centre and its move to a government community cloud."],
  ["sp17", "Deepa Thomas", "Head of Public Sector", "Northwind Cloud India", "confirmed", ["v06"], "Leads public-sector cloud programmes for a domestic cloud provider."],
  ["sp18", "Gurpreet Sandhu", "Commissioner, Agriculture & Farmers Welfare", "State Government", "confirmed", ["v07"], "Oversees the state's land-record digitisation and crop-survey programme."],
  ["sp19", "Dr. Sneha Patil", "Founder", "KisanGrid", "confirmed", ["v07"], "Founded an agri-advisory start-up working with farmer producer organisations."],
  ["sp20", "Manish Dubey", "Director", "Common Services Network", "unverified", ["v07"], "Runs a network of village-level service centres and entrepreneurs."],
  ["sp21", "Aparna Iyengar", "Programme Lead", "Rural Connectivity Foundation", "ai_suggested", ["v07"], "Works on last-mile connectivity and gender inclusion in rural digital programmes."],
  ["sp22", "Dr. Hemant Kulshreshtha", "Jury Chair", "eGovernance Excellence Awards", "confirmed", ["v08"], "Chaired the 2026 awards jury."],
  ["sp23", "Rekha Pillai", "Additional Secretary", "Department of Administrative Reforms", "confirmed", ["v08"], "Leads administrative-reform initiatives and the replication of award-winning projects."],
  ["sp24", "Siddharth Rao", "Editor-in-Chief", "eGov Magazine", "confirmed", ["v08"], "Hosts the eGovernance Excellence Awards."],
];

export const demoSpeakers: Speaker[] = speakerSeeds.map(([id, name, designation, organisation, verification, videoIds, bio]) => ({
  id,
  projectId: P,
  name,
  designation,
  organisation,
  verification,
  videoIds,
  bio,
  portraitAssetId: `ast_portrait_${id}`,
}));

type VideoSeed = [id: string, title: string, durationSec: number, sourceType: VideoSource["sourceType"], url: string | undefined, fileName: string | undefined, sessionId: string];

const videoSeeds: VideoSeed[] = [
  ["v01", "Inaugural Session — India's Digital Public Infrastructure: The Next Decade", 3134, "youtube", "https://www.youtube.com/watch?v=demo-negs26-01", undefined, "ses01"],
  ["v02", "Panel — AI for Governance: From Pilots to Platforms", 3690, "youtube", "https://www.youtube.com/watch?v=demo-negs26-02", undefined, "ses02"],
  ["v03", "Panel — Cyber Resilience for Critical Government Systems", 2885, "google_drive", "https://drive.google.com/file/d/demo-negs26-03/view", undefined, "ses03"],
  ["v04", "Fireside Chat — Smart Cities 2.0: Data-Driven Urban Services", 2320, "google_drive", "https://drive.google.com/file/d/demo-negs26-04/view", undefined, "ses04"],
  ["v05", "Panel — Digital Health Stack: Interoperability at Scale", 3312, "youtube", "https://www.youtube.com/watch?v=demo-negs26-05", undefined, "ses05"],
  ["v06", "Keynote — Sovereign Cloud and State Data Centres", 1938, "upload_video", undefined, "NEGS26_Hall-A_Keynote_Cloud.mp4", "ses06"],
  ["v07", "Panel — Agri-Stack and Rural Digital Inclusion", 2870, "upload_video", undefined, "NEGS26_Hall-B_Agristack.mp4", "ses07"],
  ["v08", "Valedictory — eGovernance Excellence Awards 2026", 2485, "upload_audio", undefined, "NEGS26_Awards_Night_Audio.m4a", "ses08"],
];

/* Transcript excerpts: [startSec, speakerId, text] */
const transcriptSeeds: Record<string, [number, string, string][]> = {
  v01: [
    [0, "sp02", "Good morning, and welcome to the National eGovernance Summit 2026. Over the next two days we have more than forty speakers from central ministries, state governments and industry, and one simple question in front of us: how do we make digital public infrastructure work for every citizen, not just the connected ones?"],
    [96, "sp02", "Before I invite our chief guest, a word on format. Every session today is being recorded, and the eGov team will be publishing a special issue from these discussions. So speak freely, but speak on the record."],
    [210, "sp01", "Thank you, Anil. Ten years ago we were debating whether citizens would trust a digital identity. Today the debate is very different. The rails are built. The question now is what we run on them, and who gets left behind when we do."],
    [395, "sp01", "Let me share one number that I think about every week. In the last financial year, our citizen services platform handled 1.4 billion transactions. But nearly 30 percent of those were assisted, meaning someone at a service centre did it on behalf of the citizen."],
    [560, "sp01", "That is not a failure. That is a design input. Assisted digital is how inclusion actually happens in this country, and our next generation of platforms must treat the service centre operator as a first-class user."],
    [790, "sp01", "We are announcing today that the department will publish open interface standards for assisted service delivery by March 2027, so that every state can plug its own service centres into a common grievance and tracking layer."],
    [1040, "sp01", "Infrastructure is only public when every citizen can actually use it. If a widow in a district headquarters cannot get her pension certificate without three visits, then our infrastructure is not finished, however elegant the architecture diagrams look."],
    [1310, "sp03", "From the state side, I want to add a practical lens. We moved 212 services online in the last three years. The ones that succeeded had one thing in common: we redesigned the process before we digitised it."],
    [1525, "sp03", "The ones that struggled were the ones where we simply converted a paper form into a web form. Citizens could tell the difference immediately."],
    [1780, "sp03", "Our average time to deliver a caste or income certificate came down from 21 days to 4 days. But the bigger change was predictability. Citizens now get an SMS with a committed date, and we hold ourselves to it."],
    [2050, "sp01", "Data sharing between departments is the next frontier, and it has to be consent-based. Citizens must be able to see which department accessed their records and why. Trust is not a slogan; it is an audit log the citizen can read."],
    [2390, "sp02", "Questions from the floor. Yes, the gentleman in the third row."],
    [2420, "sp01", "The question is about funding for smaller states. Honestly, the constraint is less about money and more about people. We will be running a shared capacity programme with twelve states to place product managers inside departments."],
    [2780, "sp03", "And if I may add, the best investment we made was training our own district officers. Technology vendors come and go. Institutional capability stays."],
    [3010, "sp02", "Thank you both. That sets the tone for everything that follows."],
  ],
  v02: [
    [0, "sp04", "Welcome to our panel on AI for governance. Everyone has run a pilot. Very few have run a platform. So let us talk about what it takes to cross that gap."],
    [140, "sp05", "The honest answer is that most pilots fail on data, not on models. We found that in nine out of eleven pilots we reviewed, the department did not have a clean, labelled dataset when the project began."],
    [380, "sp05", "So the programme office is now funding data readiness first. Before a department gets money for an AI model, it has to show us a data inventory and a named data steward."],
    [610, "sp06", "From the industry side, I would add that procurement is still designed for buying hardware. AI systems need to be evaluated continuously after deployment, and our contracts rarely allow for that."],
    [905, "sp06", "We worked with one state on grievance classification. The model was 91 percent accurate in testing. In the first month of production it dropped to 78 percent because citizens wrote complaints very differently from the training data."],
    [1180, "sp07", "That is exactly why human review has to stay in the loop for anything that affects entitlements. AI can sort and route, but a person must decide when someone's benefit is at stake."],
    [1460, "sp04", "Farah, is there a framework coming that departments can actually follow?"],
    [1490, "sp05", "Yes. We will release a risk-tiered AI deployment framework for public services in the first quarter of next year. Low-risk uses like document summarisation get a fast track. High-risk uses like eligibility decisions need an impact assessment and an appeal mechanism."],
    [1820, "sp07", "Language is the other big opportunity. Voice interfaces in local languages can do more for inclusion than any app redesign. A farmer should be able to ask about a scheme in her own dialect and get an accurate answer."],
    [2140, "sp06", "But accuracy in local languages is uneven. We should publish evaluation benchmarks by language so that departments know where a system is reliable and where it is not."],
    [2510, "sp04", "A question from the audience on job losses in government offices."],
    [2540, "sp05", "Our experience is that AI changes the work rather than removing it. Clerks who spent days on data entry now spend that time on verification and citizen follow-up."],
    [2990, "sp07", "Build small, measure honestly, and scale only what works. That is the whole playbook."],
    [3400, "sp04", "On that note, thank you to our panel."],
  ],
  v03: [
    [0, "sp08", "Cyber resilience is no longer an IT problem. When a hospital system or a land records portal goes down, it is a governance failure that citizens feel immediately."],
    [210, "sp08", "Last year our coordination centre handled 2,300 reported incidents across state departments. Most were phishing and credential misuse, not sophisticated attacks."],
    [470, "sp09", "Which tells you where the investment should go. Identity, access management and basic hygiene will prevent more damage than the most advanced threat intelligence platform."],
    [760, "sp10", "I would push the room on recovery. Every department has a backup policy. Very few have tested a full restore in the last twelve months."],
    [1040, "sp08", "We are making that mandatory. From next April, critical state systems must complete and document a restore drill twice a year."],
    [1330, "sp09", "Supply chain is the other blind spot. Your security is only as strong as the smallest vendor with access to your network."],
    [1650, "sp10", "Resilience means assuming you will be breached and designing so that the citizen service keeps running anyway."],
    [1990, "sp08", "We also need more security professionals in government. Our centre is creating a cadre of 150 trained officers who will sit inside departments rather than in a central team."],
    [2420, "sp09", "And please, share incidents. The department that hides an attack helps the attacker hit the next department."],
    [2760, "sp08", "Thank you. Let us keep this conversation going beyond the summit."],
  ],
  v04: [
    [0, "sp12", "Kirti, cities have been collecting data for a decade now. What has actually changed for residents?"],
    [95, "sp11", "The biggest change is that we stopped building dashboards for officials and started building services for residents. A dashboard does not fix a pothole."],
    [330, "sp11", "Our integrated command centre now routes civic complaints directly to field teams. The average time to close a water supply complaint fell from six days to under two."],
    [640, "sp12", "What made that possible? Technology or process?"],
    [700, "sp11", "Process first. We gave ward engineers a single mobile app and made closure photographs mandatory. Accountability became visible."],
    [1020, "sp12", "There is a risk that smart city projects become vendor showcases. How do you avoid that?"],
    [1080, "sp11", "We insist on open data standards in every contract. If we cannot take our data and move to another vendor, we do not sign."],
    [1460, "sp11", "The next step is predictive maintenance. We have sensors on 340 pumping stations, and we want to fix failures before residents notice them."],
    [1890, "sp12", "Final question: what should a smaller city do first?"],
    [1930, "sp11", "Start with one service residents complain about the most, fix it end to end, and publish the results. Trust compounds."],
  ],
  v05: [
    [0, "sp14", "Interoperability is the word everyone uses and very few define. For us it means a patient's record follows the patient, with consent, across public and private facilities."],
    [260, "sp13", "In our state, 4.2 crore health IDs have been created, but creation is the easy part. The harder metric is how many records are actually linked to those IDs. Today that number is around 38 percent."],
    [600, "sp15", "The private sector is ready to integrate, but we need stable APIs and clear certification. Every time a specification changes without notice, smaller clinics drop off."],
    [920, "sp13", "We have heard that feedback. From January, our state sandbox will offer a certification track with fixed release windows twice a year."],
    [1270, "sp14", "Data quality is the silent problem. If a diagnosis is entered as free text in three different spellings, no analytics system will save you."],
    [1650, "sp15", "Telemedicine showed what is possible. In remote blocks, teleconsultations now account for a fifth of all outpatient visits at primary health centres."],
    [2010, "sp13", "Consent must be meaningful. We are testing a voice-based consent flow for patients who cannot read the screen."],
    [2440, "sp14", "Privacy and utility are not opposites. Good architecture gives you both."],
    [2890, "sp13", "The goal is simple: no patient should have to carry a plastic bag of old prescriptions to a new doctor."],
    [3200, "sp14", "Thank you all."],
  ],
  v06: [
    [0, "sp16", "Every state is now a data organisation, whether it likes it or not. The question is where that data lives and who controls it."],
    [240, "sp16", "Our state data centre has migrated 64 departmental applications to a government community cloud over the last two years."],
    [520, "sp16", "Migration is not about moving servers. It is about retiring old applications that nobody remembers how to maintain."],
    [840, "sp17", "From the provider side, sovereign cloud means three things: data residency, operational control by cleared personnel, and the ability to exit without penalty."],
    [1150, "sp16", "We are adopting a cloud-first policy for all new state applications from the next financial year, with a clear exception process for systems that must remain on-premise."],
    [1500, "sp17", "Cost visibility is essential. Departments should see what they consume every month, otherwise cloud bills become the new legacy problem."],
    [1820, "sp16", "Thank you, and I look forward to the discussions."],
  ],
  v07: [
    [0, "sp20", "Agri-stack is about putting the farmer at the centre of the data, not the scheme."],
    [180, "sp18", "We have digitised land records for 96 percent of villages in the state. The next step is linking them to crop surveys done by field staff using a mobile app."],
    [480, "sp19", "For farmers, the value shows up when a loan or an insurance claim gets processed without a middleman. That is the test."],
    [820, "sp21", "Connectivity is still the bottleneck. In some blocks, field staff upload survey data at the end of the day from the one spot with a signal."],
    [1150, "sp18", "Offline-first apps were the single biggest improvement we made. Data syncs whenever the network returns."],
    [1490, "sp19", "Advisory services in local languages are where AI can help, but the advice must be accountable to an agronomist."],
    [1850, "sp20", "Our common service centres processed crop insurance enrolments for farmers who had never used a smartphone. The village entrepreneur is the bridge."],
    [2240, "sp21", "Women farmers are under-represented in land records. Inclusion has to be measured, not assumed."],
    [2690, "sp18", "Thank you."],
  ],
  v08: [
    [0, "sp24", "Good evening and welcome to the eGovernance Excellence Awards 2026. This year the jury reviewed 286 nominations from 27 states and union territories."],
    [240, "sp22", "The jury looked for three things: measurable citizen impact, the ability to scale, and honesty about what did not work."],
    [560, "sp22", "Several entries this year came from district administrations, which tells us innovation is no longer only a capital-city story."],
    [900, "sp23", "Recognition matters because it gives officers permission to take risks. Most good ideas in government die because nobody wants to be the first to try."],
    [1300, "sp24", "The award for Citizen Service Delivery goes to a district team that cut pension processing time from forty-five days to seven."],
    [1760, "sp23", "To every officer here: document what you did, so that someone in another state can copy it next year."],
    [2200, "sp24", "Thank you for joining us, and we will see you at the next summit."],
  ],
};

const speakerName = (id: string) => demoSpeakers.find((s) => s.id === id)?.name ?? "Unknown speaker";

export const segmentId = (videoId: string, start: number) => `seg_${videoId}_${start}`;

export const demoSegments: TranscriptSegment[] = Object.entries(transcriptSeeds).flatMap(([videoId, rows]) => {
  const duration = videoSeeds.find((v) => v[0] === videoId)?.[2] ?? 0;
  return rows.map(([start, speakerId, text], i) => ({
    id: segmentId(videoId, start),
    videoId,
    start,
    end: i < rows.length - 1 ? Math.min(rows[i + 1][0], start + Math.max(25, Math.round(text.split(" ").length / 2.4))) : Math.min(duration, start + 30),
    speakerId,
    speakerLabel: speakerName(speakerId),
    text,
  }));
});

const wordsFor = (videoId: string) => (transcriptSeeds[videoId] ?? []).reduce((n, [, , t]) => n + t.split(/\s+/).length, 0);

export const demoVideos: VideoSource[] = videoSeeds.map(([id, title, durationSec, sourceType, url, fileName, sessionId], i) => ({
  id,
  projectId: P,
  sourceType,
  url,
  externalId: url ? `demo-negs26-0${i + 1}` : undefined,
  fileName,
  fileSizeBytes: sourceType === "upload_audio" ? 38_400_000 : sourceType === "upload_video" ? Math.round(durationSec * 1_150_000) : undefined,
  title,
  durationSec,
  sessionId,
  processing: { state: "ready", progress: 100, updatedAt: "2026-10-17T09:12:00.000Z" },
  transcription: {
    state: "complete",
    method: "demo_seed",
    language: "en-IN",
    wordCount: wordsFor(id),
  },
  simulated: true,
  addedAt: "2026-10-16T10:05:00.000Z",
}));

type SessionSeed = [id: string, videoId: string, title: string, kind: EventSession["kind"], speakers: string[], topics: string[], summary: string];

const sessionSeeds: SessionSeed[] = [
  ["ses01", "v01", "Inaugural Session: India's Digital Public Infrastructure — The Next Decade", "inaugural", ["sp02", "sp01", "sp03"], ["Digital public infrastructure", "Assisted service delivery", "Process redesign", "Consent-based data sharing", "State capacity"], "The Secretary framed the next phase of digital public infrastructure around inclusion, arguing that assisted transactions are a design input rather than a failure, and announced open interface standards for assisted service delivery. A state mission director described how redesigning processes before digitising them cut certificate delivery times."],
  ["ses02", "v02", "AI for Governance: From Pilots to Platforms", "panel", ["sp04", "sp05", "sp06", "sp07"], ["AI readiness", "Data stewardship", "Procurement", "Human oversight", "Indian language AI"], "Panellists agreed that most AI pilots fail on data rather than models. The programme office will fund data readiness first and release a risk-tiered deployment framework; industry called for contracts that allow continuous post-deployment evaluation."],
  ["ses03", "v03", "Cyber Resilience for Critical Government Systems", "panel", ["sp08", "sp09", "sp10"], ["Incident response", "Identity and access", "Restore drills", "Supply-chain risk", "Security cadre"], "The discussion moved cyber security from IT to governance. Speakers prioritised basic hygiene and identity controls, and the coordination centre announced mandatory twice-yearly restore drills for critical state systems."],
  ["ses04", "v04", "Smart Cities 2.0: Data-Driven Urban Services", "fireside", ["sp12", "sp11"], ["Command centres", "Civic complaints", "Open data standards", "Predictive maintenance"], "A city CEO described shifting from dashboards to resident services, with complaint routing to field teams and mandatory closure photographs. Open data standards in contracts were presented as protection against vendor lock-in."],
  ["ses05", "v05", "Digital Health Stack: Interoperability at Scale", "panel", ["sp14", "sp13", "sp15"], ["Health IDs", "Record linkage", "API certification", "Data quality", "Consent"], "The panel distinguished health ID creation from record linkage, discussed certification stability for private providers, and highlighted data quality and meaningful consent as the hard problems."],
  ["ses06", "v06", "Sovereign Cloud and State Data Centres", "keynote", ["sp16", "sp17"], ["Community cloud", "Application retirement", "Cloud-first policy", "Cost visibility"], "The keynote positioned states as data organisations, reported progress on migrating departmental applications to a community cloud, and announced a cloud-first policy for new applications."],
  ["ses07", "v07", "Agri-Stack and Rural Digital Inclusion", "panel", ["sp20", "sp18", "sp19", "sp21"], ["Land records", "Crop surveys", "Offline-first apps", "Service centres", "Gender inclusion"], "Speakers linked land-record digitisation to crop surveys and farmer services, credited offline-first apps for progress in low-connectivity blocks, and called for measured inclusion of women farmers."],
  ["ses08", "v08", "Valedictory and eGovernance Excellence Awards 2026", "awards", ["sp24", "sp22", "sp23"], ["Awards", "District innovation", "Replication"], "The awards closed the summit, with the jury emphasising measurable impact, scalability and candour. Officials urged winners to document their work so other states can replicate it."],
];

export const demoSessions: EventSession[] = sessionSeeds.map(([id, videoId, title, kind, speakerIds, topics, summary]) => ({
  id,
  projectId: P,
  videoId,
  title,
  kind,
  speakerIds,
  topics,
  summary,
  status: id === "ses07" ? "draft" : "approved",
}));

type FactSeed = [id: string, videoId: string, start: number, kind: ExtractedFact["kind"], speakerId: string, text: string, provenance: ExtractedFact["provenance"], status: ExtractedFact["status"], confidence: number];

const factSeeds: FactSeed[] = [
  ["f01", "v01", 1040, "quote", "sp01", "Infrastructure is only public when every citizen can actually use it.", "transcript_verbatim", "approved", 0.97],
  ["f02", "v01", 2050, "quote", "sp01", "Trust is not a slogan; it is an audit log the citizen can read.", "transcript_verbatim", "approved", 0.96],
  ["f03", "v01", 395, "statistic", "sp01", "our citizen services platform handled 1.4 billion transactions", "transcript_verbatim", "approved", 0.95],
  ["f04", "v01", 790, "announcement", "sp01", "the department will publish open interface standards for assisted service delivery by March 2027", "transcript_verbatim", "approved", 0.94],
  ["f05", "v01", 1780, "statistic", "sp03", "Our average time to deliver a caste or income certificate came down from 21 days to 4 days.", "transcript_verbatim", "approved", 0.95],
  ["f06", "v01", 1310, "quote", "sp03", "we redesigned the process before we digitised it.", "transcript_verbatim", "approved", 0.93],
  ["f07", "v01", 560, "discussion_point", "sp01", "Service-centre operators should be treated as primary users when designing citizen platforms.", "ai_interpretation", "pending", 0.81],
  ["f08", "v01", 2420, "announcement", "sp01", "a shared capacity programme with twelve states to place product managers inside departments", "transcript_verbatim", "pending", 0.9],
  ["f09", "v02", 140, "statistic", "sp05", "in nine out of eleven pilots we reviewed, the department did not have a clean, labelled dataset", "transcript_verbatim", "approved", 0.94],
  ["f10", "v02", 1180, "quote", "sp07", "AI can sort and route, but a person must decide when someone's benefit is at stake.", "transcript_verbatim", "approved", 0.96],
  ["f11", "v02", 905, "statistic", "sp06", "The model was 91 percent accurate in testing. In the first month of production it dropped to 78 percent", "transcript_verbatim", "approved", 0.95],
  ["f12", "v02", 1490, "announcement", "sp05", "We will release a risk-tiered AI deployment framework for public services in the first quarter of next year.", "transcript_verbatim", "approved", 0.95],
  ["f13", "v02", 2990, "quote", "sp07", "Build small, measure honestly, and scale only what works.", "transcript_verbatim", "approved", 0.97],
  ["f14", "v02", 610, "discussion_point", "sp06", "Procurement rules should allow continuous evaluation of AI systems after deployment.", "ai_interpretation", "pending", 0.78],
  ["f15", "v03", 210, "statistic", "sp08", "Last year our coordination centre handled 2,300 reported incidents across state departments.", "transcript_verbatim", "approved", 0.95],
  ["f16", "v03", 1040, "announcement", "sp08", "From next April, critical state systems must complete and document a restore drill twice a year.", "transcript_verbatim", "approved", 0.95],
  ["f17", "v03", 1650, "quote", "sp10", "Resilience means assuming you will be breached and designing so that the citizen service keeps running anyway.", "transcript_verbatim", "approved", 0.92],
  ["f18", "v03", 2420, "quote", "sp09", "The department that hides an attack helps the attacker hit the next department.", "transcript_verbatim", "approved", 0.96],
  ["f19", "v03", 1990, "statistic", "sp08", "creating a cadre of 150 trained officers who will sit inside departments", "transcript_verbatim", "pending", 0.9],
  ["f20", "v04", 95, "quote", "sp11", "A dashboard does not fix a pothole.", "transcript_verbatim", "approved", 0.98],
  ["f21", "v04", 330, "statistic", "sp11", "The average time to close a water supply complaint fell from six days to under two.", "transcript_verbatim", "approved", 0.95],
  ["f22", "v04", 1080, "quote", "sp11", "If we cannot take our data and move to another vendor, we do not sign.", "transcript_verbatim", "approved", 0.96],
  ["f23", "v04", 1460, "statistic", "sp11", "We have sensors on 340 pumping stations", "transcript_verbatim", "pending", 0.9],
  ["f24", "v05", 260, "statistic", "sp13", "4.2 crore health IDs have been created", "transcript_verbatim", "approved", 0.94],
  ["f25", "v05", 260, "statistic", "sp13", "Today that number is around 38 percent.", "transcript_verbatim", "approved", 0.9],
  ["f26", "v05", 920, "announcement", "sp13", "From January, our state sandbox will offer a certification track with fixed release windows twice a year.", "transcript_verbatim", "approved", 0.95],
  ["f27", "v05", 2890, "quote", "sp13", "No patient should have to carry a plastic bag of old prescriptions to a new doctor.", "transcript_verbatim", "approved", 0.95],
  ["f28", "v05", 1650, "statistic", "sp15", "teleconsultations now account for a fifth of all outpatient visits at primary health centres", "transcript_verbatim", "approved", 0.93],
  ["f29", "v05", 2440, "quote", "sp14", "Privacy and utility are not opposites. Good architecture gives you both.", "transcript_verbatim", "approved", 0.96],
  ["f30", "v06", 240, "statistic", "sp16", "Our state data centre has migrated 64 departmental applications to a government community cloud over the last two years.", "transcript_verbatim", "approved", 0.95],
  ["f31", "v06", 1150, "announcement", "sp16", "We are adopting a cloud-first policy for all new state applications from the next financial year", "transcript_verbatim", "approved", 0.94],
  ["f32", "v06", 840, "quote", "sp17", "sovereign cloud means three things: data residency, operational control by cleared personnel, and the ability to exit without penalty.", "transcript_verbatim", "approved", 0.95],
  ["f33", "v07", 180, "statistic", "sp18", "We have digitised land records for 96 percent of villages in the state.", "transcript_verbatim", "approved", 0.95],
  ["f34", "v07", 480, "quote", "sp19", "For farmers, the value shows up when a loan or an insurance claim gets processed without a middleman.", "transcript_verbatim", "approved", 0.94],
  ["f35", "v07", 2240, "quote", "sp21", "Inclusion has to be measured, not assumed.", "transcript_verbatim", "pending", 0.97],
  ["f36", "v07", 1150, "discussion_point", "sp18", "Offline-first mobile apps were cited as the most effective fix for patchy rural connectivity.", "ai_interpretation", "approved", 0.84],
  ["f37", "v08", 0, "statistic", "sp24", "the jury reviewed 286 nominations from 27 states and union territories", "transcript_verbatim", "approved", 0.95],
  ["f38", "v08", 900, "quote", "sp23", "Most good ideas in government die because nobody wants to be the first to try.", "transcript_verbatim", "approved", 0.96],
  ["f39", "v08", 1300, "statistic", "sp24", "cut pension processing time from forty-five days to seven", "transcript_verbatim", "approved", 0.94],
  ["f40", "v08", 560, "quote", "sp22", "innovation is no longer only a capital-city story", "transcript_verbatim", "approved", 0.93],
];

export const demoFacts: ExtractedFact[] = factSeeds.map(([id, videoId, start, kind, speakerId, text, provenance, status, confidence]) => ({
  id,
  projectId: P,
  videoId,
  segmentId: segmentId(videoId, start),
  kind,
  text,
  speakerId,
  timestamp: start,
  provenance,
  status,
  confidence,
}));
