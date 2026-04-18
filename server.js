'use strict';

/* ── DNS fix: force Google DNS — bypasses Reliance router block ── */
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);

require('dotenv').config();
const admin = require('firebase-admin');
if (!admin.apps.length) {
    try {
        const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
        if (privateKey && privateKey.trim()) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    project_id: 'ai-health-assistant-3938-9326b',
                    private_key_id: 'c90e40a1c69fa1389e501da32053d9ad883cdd42',
                    private_key: privateKey,
                    client_email: 'firebase-adminsdk-fbsvc@ai-health-assistant-3938-9326b.iam.gserviceaccount.com',
                })
            });
            console.log('Firebase initialized successfully');
        } else {
            console.log('Skipping Firebase initialization - FIREBASE_PRIVATE_KEY not set');
        }
    } catch (error) {
        console.log('Firebase initialization error - running in demo mode:', error.message);
    }
}

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

/* ─────────────────────────── MONGOOSE SCHEMAS ─────────────────────────── */

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    age: { type: Number },
    gender: { type: String },
    location: { type: String },
    phone: { type: String },
    fcm_token: { type: String },
    created_at: { type: Date, default: Date.now }
});

const FamilyMemberSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    age: { type: Number, required: true },
    relationship: { type: String, default: 'Self' },
    birth_date: { type: Date }
});

const VaccinationSchema = new mongoose.Schema({
    member_id: { type: mongoose.Schema.Types.ObjectId, ref: 'FamilyMember', required: true },
    vaccine_name: { type: String, required: true },
    disease_prevented: { type: String },
    recommended_age: { type: String },
    due_age_weeks: { type: Number },
    due_date: { type: Date },
    status: { type: String, enum: ['Due', 'Completed', 'Overdue', 'Upcoming', 'pending'], default: 'Due' },
    reminder_sent: { type: Boolean, default: false },
    last_updated: { type: Date, default: Date.now }
});

const ChatHistorySchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    conv_id: { type: String },
    timestamp: { type: Date, default: Date.now },
    user_message: { type: String },
    ai_response: { type: String },
    response_mode: { type: String }
});

const User = mongoose.model('User', UserSchema);
const FamilyMember = mongoose.model('FamilyMember', FamilyMemberSchema);
const Vaccination = mongoose.model('Vaccination', VaccinationSchema);
const ChatHistory = mongoose.model('ChatHistory', ChatHistorySchema);

/* ─────────────────────────── CONNECT MONGODB ─────────────────────────── */

mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
}).catch(err => {
    console.error("❌  MongoDB connect failed:", err.message);
    console.error("    Check: Atlas Network Access (allow 0.0.0.0/0) + internet connection");
});

const db = mongoose.connection;
db.on('error', (err) => console.error('❌  MongoDB connection error:', err));
db.once('open', () => {
    const obscuredUri = process.env.MONGO_URI
        ? process.env.MONGO_URI.replace(/\/\/.*@/, '//****:****@')
        : 'Undefined';
    console.log('✅  MongoDB connection established successfully');
    console.log(`📊  Connected to: ${obscuredUri}`);
});
db.on('disconnected', () => console.log('⚠️  MongoDB disconnected. Attempting to reconnect...'));

process.on('SIGINT', async () => {
    await mongoose.connection.close();
    console.log('\n🛑  MongoDB connection closed due to app termination');
    process.exit(0);
});

/* ─────────────────────────── FULL VACCINE SCHEDULE ─────────────────────────── */

const VACCINE_SCHEDULE = [
    { vaccine_name: 'BCG', disease_prevented: 'Tuberculosis (TB)', recommended_age: 'At birth', due_age_weeks: 0 },
    { vaccine_name: 'OPV (Birth)', disease_prevented: 'Poliomyelitis (Polio)', recommended_age: 'At birth', due_age_weeks: 0 },
    { vaccine_name: 'Hepatitis B (Birth)', disease_prevented: 'Hepatitis B liver disease', recommended_age: 'At birth', due_age_weeks: 0 },
    { vaccine_name: 'OPV-1', disease_prevented: 'Poliomyelitis (Polio)', recommended_age: '6 weeks', due_age_weeks: 6 },
    { vaccine_name: 'DPT-1', disease_prevented: 'Diphtheria, Pertussis, Tetanus', recommended_age: '6 weeks', due_age_weeks: 6 },
    { vaccine_name: 'Hepatitis B-2', disease_prevented: 'Hepatitis B liver disease', recommended_age: '6 weeks', due_age_weeks: 6 },
    { vaccine_name: 'Rotavirus-1', disease_prevented: 'Severe diarrhea / Gastroenteritis', recommended_age: '6 weeks', due_age_weeks: 6 },
    { vaccine_name: 'PCV-1', disease_prevented: 'Pneumonia, Meningitis', recommended_age: '6 weeks', due_age_weeks: 6 },
    { vaccine_name: 'OPV-2', disease_prevented: 'Poliomyelitis (Polio)', recommended_age: '10 weeks', due_age_weeks: 10 },
    { vaccine_name: 'DPT-2', disease_prevented: 'Diphtheria, Pertussis, Tetanus', recommended_age: '10 weeks', due_age_weeks: 10 },
    { vaccine_name: 'Hepatitis B-3', disease_prevented: 'Hepatitis B liver disease', recommended_age: '10 weeks', due_age_weeks: 10 },
    { vaccine_name: 'Rotavirus-2', disease_prevented: 'Severe diarrhea / Gastroenteritis', recommended_age: '10 weeks', due_age_weeks: 10 },
    { vaccine_name: 'PCV-2', disease_prevented: 'Pneumonia, Meningitis', recommended_age: '10 weeks', due_age_weeks: 10 },
    { vaccine_name: 'OPV-3', disease_prevented: 'Poliomyelitis (Polio)', recommended_age: '14 weeks', due_age_weeks: 14 },
    { vaccine_name: 'DPT-3', disease_prevented: 'Diphtheria, Pertussis, Tetanus', recommended_age: '14 weeks', due_age_weeks: 14 },
    { vaccine_name: 'Hepatitis B-4', disease_prevented: 'Hepatitis B liver disease', recommended_age: '14 weeks', due_age_weeks: 14 },
    { vaccine_name: 'IPV', disease_prevented: 'Polio (injectable)', recommended_age: '14 weeks', due_age_weeks: 14 },
    { vaccine_name: 'PCV-3', disease_prevented: 'Pneumonia, Meningitis', recommended_age: '14 weeks', due_age_weeks: 14 },
    { vaccine_name: 'Measles / MMR-1', disease_prevented: 'Measles, Mumps, Rubella', recommended_age: '9 months (36 weeks)', due_age_weeks: 36 },
    { vaccine_name: 'Vitamin A (1st)', disease_prevented: 'Vitamin A deficiency, Blindness', recommended_age: '9 months', due_age_weeks: 36 },
    { vaccine_name: 'Typhoid', disease_prevented: 'Typhoid fever', recommended_age: '9 months', due_age_weeks: 36 },
    { vaccine_name: 'Varicella-1', disease_prevented: 'Chickenpox', recommended_age: '12 months', due_age_weeks: 48 },
    { vaccine_name: 'Hepatitis A-1', disease_prevented: 'Hepatitis A liver disease', recommended_age: '12 months', due_age_weeks: 48 },
    { vaccine_name: 'MMR-2', disease_prevented: 'Measles, Mumps, Rubella (booster)', recommended_age: '15 months', due_age_weeks: 60 },
    { vaccine_name: 'DPT Booster', disease_prevented: 'Diphtheria, Pertussis, Tetanus', recommended_age: '18 months', due_age_weeks: 72 },
    { vaccine_name: 'Hepatitis A-2', disease_prevented: 'Hepatitis A liver disease', recommended_age: '18 months', due_age_weeks: 72 },
    { vaccine_name: 'Varicella-2', disease_prevented: 'Chickenpox (booster)', recommended_age: '4-6 years', due_age_weeks: 208 },
    { vaccine_name: 'Influenza (Annual)', disease_prevented: 'Influenza / Seasonal Flu', recommended_age: '6 months+ (annual)', due_age_weeks: 26 },
    { vaccine_name: 'HPV', disease_prevented: 'Human Papillomavirus / Cervical CA', recommended_age: '9-14 years', due_age_weeks: 468 },
    { vaccine_name: 'Meningococcal', disease_prevented: 'Bacterial Meningitis', recommended_age: '11-12 years', due_age_weeks: 572 },
    { vaccine_name: 'Tetanus (Adult)', disease_prevented: 'Tetanus (adult booster)', recommended_age: 'Every 10 years', due_age_weeks: 780 },
    { vaccine_name: 'COVID-19', disease_prevented: 'COVID-19 coronavirus', recommended_age: '12+ years', due_age_weeks: 624 },
    { vaccine_name: 'Shingles (Zoster)', disease_prevented: 'Shingles / Herpes Zoster', recommended_age: '50+ years', due_age_weeks: 2600 },
];

/* ─────────────────────────── HELPERS ─────────────────────────── */

function calcDueDate(birthDate, dueAgeWeeks) {
    if (!birthDate) return null;
    const d = new Date(birthDate);
    d.setDate(d.getDate() + dueAgeWeeks * 7);
    return d;
}

function deriveStatus(birthDate, dueAgeWeeks) {
    if (!birthDate) return 'Upcoming';
    const now = new Date();
    const ageWeeksNow = (now - new Date(birthDate)) / (7 * 24 * 3600 * 1000);
    if (ageWeeksNow < dueAgeWeeks - 4) return 'Upcoming';
    if (ageWeeksNow >= dueAgeWeeks - 4 && ageWeeksNow <= dueAgeWeeks + 4) return 'Due';
    if (ageWeeksNow > dueAgeWeeks + 4) return 'Overdue';
    return 'Upcoming';
}

function buildDefaultVaccines(member) {
    const ageWeeks = (member.age || 0) * 52;
    return VACCINE_SCHEDULE.map(v => {
        let status = 'Upcoming';
        if (ageWeeks >= v.due_age_weeks - 4 && ageWeeks <= v.due_age_weeks + 4) status = 'Due';
        else if (ageWeeks > v.due_age_weeks + 4) status = 'Overdue';
        return {
            member_id: member._id,
            vaccine_name: v.vaccine_name,
            disease_prevented: v.disease_prevented,
            recommended_age: v.recommended_age,
            due_age_weeks: v.due_age_weeks,
            due_date: member.birth_date ? calcDueDate(member.birth_date, v.due_age_weeks) : null,
            status
        };
    });
}

function buildVaccinesWithDueDates(memberId, birthDate) {
    return VACCINE_SCHEDULE.map(v => ({
        member_id: memberId,
        vaccine_name: v.vaccine_name,
        disease_prevented: v.disease_prevented,
        recommended_age: v.recommended_age,
        due_age_weeks: v.due_age_weeks,
        due_date: calcDueDate(birthDate, v.due_age_weeks),
        status: deriveStatus(birthDate, v.due_age_weeks),
        reminder_sent: false
    }));
}

/* ── EMAIL MODULE — Resend HTTPS API ──────────────────────────────────────────── */
/* Railway blocks outbound SMTP (port 587/465). Resend uses HTTPS port 443.       */
/* Sign up free at resend.com → API Keys. Add RESEND_API_KEY to Railway Variables */

const https = require('https');

async function sendViaResend({ toEmail, subject, html }) {
    const key = process.env.RESEND_API_KEY;
    if (!key) return { skipped: true, reason: 'RESEND_API_KEY not set' };

    const from = process.env.RESEND_FROM_EMAIL || 'AI Health Assistant <onboarding@resend.dev>';
    const payload = JSON.stringify({ from, to: [toEmail], subject, html });

    return new Promise((resolve) => {
        const req = https.request({
            hostname: 'api.resend.com',
            path: '/emails',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        console.log(`✉️  [Resend] Sent to ${toEmail} id: ${data.id}`);
                        resolve({ sent: true, messageId: data.id });
                    } else {
                        console.error(`❌  [Resend] ${res.statusCode}:`, data.message || body);
                        resolve({ sent: false, error: data.message || body });
                    }
                } catch (e) { resolve({ sent: false, error: e.message }); }
            });
        });
        req.on('error', e => { console.error('❌  [Resend]', e.message); resolve({ sent: false, error: e.message }); });
        req.write(payload);
        req.end();
    });
}

/* SMTP fallback — only for local dev, Railway always uses Resend above */
let emailTransporter = null;
function getTransporter() {
    if (!emailTransporter) {
        emailTransporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.EMAIL_PORT || '587'),
            secure: false,
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD }
        });
    }
    return emailTransporter;
}

async function sendEmail({ toEmail, subject, html }) {
    // Prefer Resend (works on Railway). Fall back to SMTP only locally.
    if (process.env.RESEND_API_KEY) return sendViaResend({ toEmail, subject, html });
    if (!process.env.EMAIL_USER || process.env.EMAIL_USER === 'your_email@gmail.com')
        return { skipped: true };
    try {
        const info = await getTransporter().sendMail({
            from: `"AI Health Assistant" <${process.env.EMAIL_USER}>`,
            to: toEmail, subject, html
        });
        console.log(`✉️  [SMTP] Sent to ${toEmail}:`, info.messageId);
        return { sent: true, messageId: info.messageId };
    } catch (err) {
        console.error('❌  [SMTP] Error:', err.message);
        return { sent: false, error: err.message };
    }
}

async function sendReminderEmail({ toEmail, childName, vaccines, isUrgent = false }) {
    if (!process.env.RESEND_API_KEY && (!process.env.EMAIL_USER || process.env.EMAIL_USER === 'your_email@gmail.com')) {
        console.log('⚠️  Email not configured – skipping for:', toEmail);
        return { skipped: true };
    }

    const fromName = process.env.EMAIL_FROM_NAME || 'AI Health Assistant';
    const subject = isUrgent
        ? `⚠️ URGENT: Vaccine Due Tomorrow — ${childName}`
        : `💉 Vaccine Reminder — ${childName}`;

    const vaccineRows = vaccines.map(v => {
        const dueStr = v.due_date
            ? new Date(v.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
            : v.recommended_age || 'As recommended';
        return `<tr>
          <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#1a202c;">${v.vaccine_name}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;color:#4a5568;">${v.disease_prevented || '—'}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;color:${isUrgent ? '#c53030' : '#2b6cb0'};font-weight:600;">${dueStr}</td>
        </tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;background:#f7fafc;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7fafc;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <tr><td style="background:linear-gradient(135deg,#14b8a6,#3b82f6);padding:32px 36px;text-align:center;">
          <div style="font-size:36px;margin-bottom:10px;">💉</div>
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Vaccine Reminder</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">AI Health Assistant</p>
        </td></tr>
        <tr><td style="padding:32px 36px;">
          <p style="color:#4a5568;font-size:15px;line-height:1.7;margin:0 0 20px;">
            Hello,<br><br>
            This is a ${isUrgent ? '<strong>urgent</strong>' : ''} reminder that <strong>${childName}</strong>
            is due for the following vaccine${vaccines.length > 1 ? 's' : ''}:
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            <thead><tr style="background:#f0fdf4;">
              <th style="padding:10px 14px;text-align:left;font-size:12px;color:#718096;">Vaccine</th>
              <th style="padding:10px 14px;text-align:left;font-size:12px;color:#718096;">Prevents</th>
              <th style="padding:10px 14px;text-align:left;font-size:12px;color:#718096;">Due Date</th>
            </tr></thead>
            <tbody>${vaccineRows}</tbody>
          </table>
          <div style="background:#fffbeb;border:1px solid #fbbf24;border-radius:8px;padding:14px 18px;margin-top:20px;">
            <p style="margin:0;color:#92400e;font-size:12px;line-height:1.6;">
              ⚠️ <strong>Disclaimer:</strong> This system does not replace medical professionals.
              Always consult a qualified healthcare provider before making any medical decisions.
            </p>
          </div>
        </td></tr>
        <tr><td style="background:#f7fafc;padding:20px 36px;text-align:center;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#a0aec0;font-size:12px;">AI Health Assistant — Smart. Safe. Preventive Healthcare.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    return sendEmail({ toEmail, subject, html });
}


/* ─────────────────────────── FCM PUSH NOTIFICATION ─────────────────────────── */

async function sendFCMNotification({ fcmToken, childName, vaccines, isUrgent = false }) {
    if (!fcmToken) return { skipped: true };
    const vaccineList = vaccines.map(v => v.vaccine_name).join(', ');
    const title = isUrgent
        ? `⚠️ URGENT: ${childName}'s Vaccine Due Tomorrow!`
        : `💉 Vaccine Reminder for ${childName}`;
    const body = `${vaccineList} — Please visit your nearest clinic.`;
    try {
        const response = await admin.messaging().send({
            notification: { title, body },
            android: { notification: { sound: 'default', priority: 'high', channelId: 'vaccine_reminders' } },
            data: { childName, vaccineList, isUrgent: String(isUrgent) },
            token: fcmToken
        });
        console.log(`📱  FCM notification sent:`, response);
        return { sent: true };
    } catch (err) {
        console.error('❌  FCM error:', err.message);
        return { sent: false, error: err.message };
    }
}

/* ─────────────────────────── BACKGROUND CRON JOB ─────────────────────────── */

cron.schedule('0 8 * * *', async () => {
    console.log('⏰  [CRON] Running vaccine reminder check…');
    try {
        const now = new Date();
        const in7 = new Date(now); in7.setDate(in7.getDate() + 7);
        const in1 = new Date(now); in1.setDate(in1.getDate() + 1);

        const pending = await Vaccination.find({
            status: { $in: ['Due', 'pending', 'Overdue'] },
            reminder_sent: false,
            due_date: { $gte: now, $lte: in7 }
        });

        if (pending.length === 0) { console.log('⏰  [CRON] No reminders needed today.'); return; }

        const byMember = {};
        for (const vax of pending) {
            const key = String(vax.member_id);
            if (!byMember[key]) byMember[key] = [];
            byMember[key].push(vax);
        }

        for (const [memberId, vaccines] of Object.entries(byMember)) {
            const member = await FamilyMember.findById(memberId);
            if (!member) continue;
            const user = await User.findById(member.user_id);
            if (!user || !user.email) continue;
            const isUrgent = vaccines.some(v => v.due_date <= in1);
            const result = await sendReminderEmail({ toEmail: user.email, childName: member.name, vaccines, isUrgent });
            if (result.sent) {
                const ids = vaccines.map(v => v._id);
                await Vaccination.updateMany({ _id: { $in: ids } }, { reminder_sent: true });
                console.log(`✉️  [CRON] Sent reminder for ${member.name} (${user.email}) — ${vaccines.length} vaccine(s)`);
            }
            // Send FCM push notification if user has token
            if (user.fcm_token) {
                await sendFCMNotification({ fcmToken: user.fcm_token, childName: member.name, vaccines, isUrgent });
                console.log(`📱  [CRON] FCM sent for ${member.name}`);
            }
        }
    } catch (err) { console.error('❌  [CRON] Error in reminder job:', err.message); }
}, { timezone: 'Asia/Kolkata' });

console.log('⏰  Vaccine reminder cron job scheduled (daily at 08:00 AM IST)');

/* ─────────────────────────── ROUTES: USERS ─────────────────────────── */

app.post('/api/users', async (req, res) => {
    try {
        const { name, email, age, gender, location } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });
        let user = await User.findOne({ email: email.toLowerCase().trim() });
        if (user) return res.json({ user, created: false });
        user = await User.create({ name, email, age, gender, location });
        const self = await FamilyMember.create({ user_id: user._id, name, age: Number(age) || 0, relationship: 'Self' });
        const vaccines = buildDefaultVaccines(self);
        await Vaccination.insertMany(vaccines);
        res.status(201).json({ user, created: true });
    } catch (err) {
        if (err.code === 11000) {
            const user = await User.findOne({ email: req.body.email });
            return res.json({ user, created: false });
        }
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/users/:email', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.params.email.toLowerCase().trim() });
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─────────────────────────── ROUTES: FAMILY ─────────────────────────── */

app.get('/api/family/:userId', async (req, res) => {
    try {
        const members = await FamilyMember.find({ user_id: req.params.userId });
        res.json(members);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/family', async (req, res) => {
    try {
        const { user_id, name, age, relationship, birth_date } = req.body;
        if (!user_id || !name) return res.status(400).json({ error: 'user_id and name required' });
        const member = await FamilyMember.create({
            user_id, name, age: Number(age) || 0,
            relationship: relationship || 'Other',
            birth_date: birth_date ? new Date(birth_date) : null
        });
        const vaccines = birth_date
            ? buildVaccinesWithDueDates(member._id, new Date(birth_date))
            : buildDefaultVaccines(member);
        await Vaccination.insertMany(vaccines);
        res.status(201).json(member);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/family/:memberId', async (req, res) => {
    try {
        await FamilyMember.findByIdAndDelete(req.params.memberId);
        await Vaccination.deleteMany({ member_id: req.params.memberId });
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─────────────────────────── ROUTES: VACCINATIONS ─────────────────────────── */

app.get('/api/vaccinations/:memberId', async (req, res) => {
    try {
        const records = await Vaccination.find({ member_id: req.params.memberId });
        res.json(records);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/vaccinations', async (req, res) => {
    try {
        const { member_id, vaccine_name, disease_prevented, recommended_age, status, due_age_weeks, due_date } = req.body;
        if (!member_id || !vaccine_name) return res.status(400).json({ error: 'member_id and vaccine_name are required' });
        const existing = await Vaccination.findOne({ member_id, vaccine_name });
        if (existing) return res.json(existing);
        const record = await Vaccination.create({
            member_id, vaccine_name,
            disease_prevented: disease_prevented || '',
            recommended_age: recommended_age || '',
            due_age_weeks: due_age_weeks || null,
            due_date: due_date ? new Date(due_date) : null,
            status: status || 'Due'
        });
        res.status(201).json(record);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/vaccinations/:id', async (req, res) => {
    try {
        const { status } = req.body;
        const rec = await Vaccination.findByIdAndUpdate(
            req.params.id,
            { status, last_updated: new Date() },
            { new: true }
        );
        if (!rec) return res.status(404).json({ error: 'Record not found' });
        res.json(rec);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─────────────────────────── ROUTES: CHILD REGISTRATION ─────────────────────────── */

app.post('/api/register-child', async (req, res) => {
    try {
        const { user_id, child_name, birth_date, email } = req.body;
        if (!user_id || !child_name || !birth_date)
            return res.status(400).json({ error: 'user_id, child_name, and birth_date are required' });

        const bDate = new Date(birth_date);
        if (isNaN(bDate.getTime()))
            return res.status(400).json({ error: 'Invalid birth_date. Use ISO format e.g. 2025-12-01' });

        const now = new Date();
        const ageYears = (now - bDate) / (365.25 * 24 * 3600 * 1000);

        if (email && user_id) await User.findByIdAndUpdate(user_id, { email: email.toLowerCase().trim() });

        let member = await FamilyMember.findOne({ user_id, birth_date: bDate });
        if (!member) {
            member = await FamilyMember.create({
                user_id, name: child_name,
                age: Math.max(0, ageYears),
                relationship: 'Child', birth_date: bDate
            });
        } else {
            member.name = child_name; await member.save();
            await Vaccination.deleteMany({ member_id: member._id });
        }

        const vaccines = buildVaccinesWithDueDates(member._id, bDate);
        await Vaccination.insertMany(vaccines);

        const upcoming = vaccines
            .filter(v => v.status !== 'Overdue' && v.due_date && v.due_date >= now)
            .sort((a, b) => a.due_date - b.due_date)
            .slice(0, 8);

        res.status(201).json({
            ok: true, member,
            vaccines_seeded: vaccines.length,
            upcoming_vaccines: upcoming,
            disclaimer: 'This system does not replace medical professionals. Always consult a qualified healthcare provider.'
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/vaccines/:userId', async (req, res) => {
    try {
        const members = await FamilyMember.find({ user_id: req.params.userId });
        if (!members.length) return res.json({ vaccines: [], members: [] });
        const results = [];
        for (const m of members) {
            const vaxList = await Vaccination.find({ member_id: m._id }).sort({ due_date: 1 });
            results.push({ member: { id: m._id, name: m.name, relationship: m.relationship, birth_date: m.birth_date, age: m.age }, vaccines: vaxList });
        }
        res.json({ results, disclaimer: 'This system does not replace medical professionals.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/vaccines/:id', async (req, res) => {
    try {
        const { status } = req.body;
        const allowed = ['Completed', 'Due', 'Upcoming', 'Overdue', 'pending'];
        if (status && !allowed.includes(status))
            return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
        const rec = await Vaccination.findByIdAndUpdate(
            req.params.id,
            { status: status || 'Completed', last_updated: new Date() },
            { new: true }
        );
        if (!rec) return res.status(404).json({ error: 'Vaccine record not found' });
        res.json({ ok: true, record: rec });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/vaccines/remind', async (req, res) => {
    try {
        const { vaccine_id, user_id } = req.body;
        if (!vaccine_id) return res.status(400).json({ error: 'vaccine_id is required' });
        const vax = await Vaccination.findById(vaccine_id);
        if (!vax) return res.status(404).json({ error: 'Vaccine record not found' });
        const member = await FamilyMember.findById(vax.member_id);
        if (!member) return res.status(404).json({ error: 'Family member not found' });
        const user = user_id ? await User.findById(user_id) : await User.findById(member.user_id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const now = new Date();
        const isUrgent = vax.due_date && (vax.due_date - now) <= 24 * 3600 * 1000;
        const result = await sendReminderEmail({ toEmail: user.email, childName: member.name, vaccines: [vax], isUrgent });
        if (!result.skipped) await Vaccination.findByIdAndUpdate(vaccine_id, { reminder_sent: true });

        // Also send FCM push notification if user has a registered token
        let fcmResult = { skipped: true };
        if (user.fcm_token) {
            fcmResult = await sendFCMNotification({ fcmToken: user.fcm_token, childName: member.name, vaccines: [vax], isUrgent });
            console.log(`📱  [REMIND] FCM push for ${member.name}:`, fcmResult.sent ? 'sent' : fcmResult.error || 'skipped');
        }

        const emailMsg = result.skipped
            ? 'Email not configured. Add RESEND_API_KEY to Railway Variables (free at resend.com)'
            : result.sent ? `Reminder email sent to ${user.email}` : `Email failed: ${result.error}`;
        const pushMsg = (!fcmResult.skipped && fcmResult.sent) ? ' + push notification sent.' : '';

        res.json({
            ok: true,
            sent: result.sent || false,
            skipped: result.skipped || false,
            fcm_sent: fcmResult.sent || false,
            message: emailMsg + pushMsg,
            disclaimer: 'This system does not replace medical professionals.'
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/vaccine-schedule', (req, res) => {
    res.json({ schedule: VACCINE_SCHEDULE, disclaimer: 'This system does not replace medical professionals.' });
});

/* ─────────────────────────────────────────────────────────────────
   Chat-triggered vaccine reminder with rich email
   Called when user taps "⏳ Not yet" in the chatbot vaccine card.
   Sends a detailed email: vaccine name, disease prevented, due date, next steps.
   ──────────────────────────────────────────────────────────────── */
app.post('/api/vaccines/chat-remind', async (req, res) => {
    try {
        const { member_id, user_id, vaccines } = req.body;
        if (!member_id || !user_id || !vaccines?.length)
            return res.status(400).json({ error: 'member_id, user_id, and vaccines[] are required' });

        const member = await FamilyMember.findById(member_id);
        if (!member) return res.status(404).json({ error: 'Family member not found' });

        const user = await User.findById(user_id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (!process.env.RESEND_API_KEY && (!process.env.EMAIL_USER || process.env.EMAIL_USER === 'your_email@gmail.com')) {
            return res.json({ ok: false, skipped: true, message: '⚠️ Email not configured. Add RESEND_API_KEY to Railway Variables (free at resend.com).' });
        }

        const toEmail = user.email;
        const childName = member.name;
        const fromName = process.env.EMAIL_FROM_NAME || 'AI Health Assistant';
        const today = new Date();

        function esc_html(str) {
            return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        }

        const vaccineRows = vaccines.map(v => {
            const dueDateStr = v.due_date
                ? new Date(v.due_date).toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
                : (v.ageRange || 'As recommended by doctor');
            const isOverdue = v.due_date && new Date(v.due_date) < today;
            const urgencyColor = isOverdue ? '#c53030' : '#1d4ed8';
            const urgencyLabel = isOverdue ? '⚠️ OVERDUE' : '📅 Upcoming';
            return `
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:16px 18px;">
            <div style="font-weight:700;font-size:15px;color:#1a202c;margin-bottom:4px;">💉 ${esc_html(v.name)}</div>
            <div style="font-size:13px;color:#718096;">Prevents: <strong style="color:#2d3748;">${esc_html(v.prevents||'—')}</strong></div>
          </td>
          <td style="padding:16px 18px;vertical-align:top;">
            <div style="font-size:12px;color:${urgencyColor};font-weight:700;margin-bottom:3px;">${urgencyLabel}</div>
            <div style="font-size:14px;color:${urgencyColor};font-weight:600;">${esc_html(dueDateStr)}</div>
          </td>
        </tr>`;
        }).join('');

        const overdueCount = vaccines.filter(v => v.due_date && new Date(v.due_date) < today).length;
        const subject = overdueCount > 0
            ? `⚠️ Overdue Vaccine Alert — ${childName} needs attention`
            : `💉 Vaccine Reminder — ${childName}'s upcoming vaccinations`;

        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;background:#f0f9ff;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9ff;padding:32px 16px;">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.10);">
<tr><td style="background:linear-gradient(135deg,#0f766e,#1d4ed8);padding:36px 40px;text-align:center;">
  <div style="font-size:48px;margin-bottom:12px;">💉</div>
  <h1 style="margin:0;color:#fff;font-size:24px;font-weight:800;">Vaccine Reminder</h1>
  <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">AI Health Assistant · Smart. Safe. Preventive Healthcare.</p>
</td></tr>
<tr><td style="padding:32px 40px 0;">
  <p style="margin:0 0 8px;font-size:16px;color:#2d3748;line-height:1.7;">Hello <strong>${esc_html(user.name||'there')}</strong>,</p>
  <p style="margin:0 0 24px;font-size:15px;color:#4a5568;line-height:1.7;">
    Your AI Health Assistant is reminding you about the following vaccine${vaccines.length>1?'s':''} for 
    <strong style="color:#0f766e;">${esc_html(childName)}</strong>. 
    Please visit your nearest clinic to get ${vaccines.length>1?'them':'it'} administered.
  </p>
</td></tr>
<tr><td style="padding:0 40px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
    <thead><tr style="background:#f8faff;">
      <th style="padding:12px 18px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.07em;color:#64748b;">Vaccine</th>
      <th style="padding:12px 18px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.07em;color:#64748b;">Due Date</th>
    </tr></thead>
    <tbody>${vaccineRows}</tbody>
  </table>
</td></tr>
<tr><td style="padding:24px 40px 0;">
  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-left:4px solid #16a34a;border-radius:10px;padding:18px 22px;">
    <div style="font-weight:700;font-size:14px;color:#15803d;margin-bottom:10px;">✅ Next Steps</div>
    <ol style="margin:0;padding-left:20px;color:#166534;font-size:13px;line-height:2.1;">
      <li>Book an appointment at your nearest clinic or hospital</li>
      <li>Bring your child's vaccination card / health booklet</li>
      <li>After vaccination, open the app → Vaccine Tracker → Mark as <strong>Completed</strong></li>
    </ol>
  </div>
</td></tr>
<tr><td style="padding:18px 40px;">
  <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 18px;">
    <p style="margin:0;color:#92400e;font-size:12px;line-height:1.6;">
      ⚠️ <strong>Disclaimer:</strong> This reminder is from your AI Health Assistant and does not replace 
      professional medical advice. Consult a qualified healthcare provider for your child's specific needs.
    </p>
  </div>
</td></tr>
<tr><td style="background:#f8fafc;padding:18px 40px;text-align:center;border-top:1px solid #e2e8f0;">
  <p style="margin:0;color:#94a3b8;font-size:12px;">AI Health Assistant — Smart. Safe. Preventive Healthcare.</p>
</td></tr>
</table></td></tr></table></body></html>`;

        const emailResult = await sendEmail({ toEmail, subject, html });
        if (!emailResult.sent && !emailResult.skipped) {
            console.error('[CHAT-REMIND] Email failed:', emailResult.error);
            return res.json({ ok: false, sent: false, message: `❌ Email failed: ${emailResult.error}` });
        }
        console.log(`✉️  [CHAT-REMIND] Email sent to ${toEmail}:`, emailResult.messageId || 'ok');

        // Send FCM push notification if user has token
        let fcmResult = { skipped: true };
        if (user.fcm_token) {
            const isOverdue = vaccines.some(v => v.due_date && new Date(v.due_date) < today);
            const fcmVaccines = vaccines.map(v => ({ vaccine_name: v.name, due_date: v.due_date }));
            fcmResult = await sendFCMNotification({
                fcmToken: user.fcm_token,
                childName: member.name,
                vaccines: fcmVaccines,
                isUrgent: isOverdue
            });
            console.log(`📱  [CHAT-REMIND] FCM push for ${member.name}:`, fcmResult.sent ? 'sent ✅' : (fcmResult.error || 'skipped'));
        }

        // Mark records as reminder_sent in DB
        const vaccineNames = vaccines.map(v => v.name);
        await Vaccination.updateMany(
            { member_id, vaccine_name: { $in: vaccineNames } },
            { reminder_sent: true, last_updated: new Date() }
        );

        const pushMsg = (!fcmResult.skipped && fcmResult.sent) ? ' + 📱 push notification sent.' : '';
        res.json({
            ok: true, sent: true,
            message: `✉️ Reminder sent to ${toEmail} — ${vaccines.length} vaccine${vaccines.length>1?'s':''}.${pushMsg}`,
            email: toEmail, vaccines_count: vaccines.length, fcm_sent: fcmResult.sent || false
        });

    } catch (err) {
        console.error('[CHAT-REMIND] Error:', err.message);
        res.json({ ok: false, sent: false, message: `❌ Email failed: ${err.message}` });
    }
});

/* ─────────────────────────── ROUTES: CHAT HISTORY ─────────────────────────── */

app.get('/api/chat-history/:userId', async (req, res) => {
    try {
        const records = await ChatHistory.find({ user_id: req.params.userId })
            .sort({ timestamp: -1 }).limit(200);
        res.json(records.reverse());
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/chat-history', async (req, res) => {
    try {
        const { user_id, conv_id, user_message, ai_response, response_mode } = req.body;
        if (!user_id) return res.status(400).json({ error: 'user_id required' });
        const record = await ChatHistory.create({ user_id, conv_id, user_message, ai_response, response_mode });
        res.status(201).json(record);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─────────────────────────── ROUTES: UPCOMING VACCINES POPUP ─────────────────────────── */

app.get('/api/upcoming-vaccines/:userId', async (req, res) => {
    try {
        const members = await FamilyMember.find({ user_id: req.params.userId });
        if (!members.length) return res.json([]);
        const now = new Date();
        const in3 = new Date(now); in3.setDate(in3.getDate() + 3);
        const result = [];
        for (const m of members) {
            const upcoming = await Vaccination.find({
                member_id: m._id,
                status: { $in: ['Due', 'pending', 'Overdue'] },
                due_date: { $gte: now, $lte: in3 }
            }).sort({ due_date: 1 });
            if (upcoming.length === 0) continue;
            result.push({
                child_name: m.name,
                vaccines: upcoming.map(v => {
                    const diffMs = new Date(v.due_date) - now;
                    const days_left = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
                    return { id: v._id, vaccine_name: v.vaccine_name, due_date: v.due_date ? new Date(v.due_date).toISOString().slice(0, 10) : null, days_left };
                })
            });
        }
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/vaccination/:id', async (req, res) => {
    try {
        let { status } = req.body;
        if (typeof status === 'string') status = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
        const allowed = ['Completed', 'Due', 'Upcoming', 'Overdue', 'Pending'];
        if (status && !allowed.includes(status))
            return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
        const rec = await Vaccination.findByIdAndUpdate(
            req.params.id,
            { status: status || 'Completed', last_updated: new Date() },
            { new: true }
        );
        if (!rec) return res.status(404).json({ error: 'Vaccine record not found' });
        res.json({ ok: true, record: rec });
    } catch (err) { res.status(500).json({ error: err.message }); }
});



/* ─────────────────────────── ROUTES: FCM TOKEN ─────────────────────────── */

app.post('/api/users/fcm-token', async (req, res) => {
    try {
        const { user_id, fcm_token } = req.body;
        if (!user_id || !fcm_token) return res.status(400).json({ error: 'user_id and fcm_token required' });
        await User.findByIdAndUpdate(user_id, { fcm_token });
        console.log(`📱  FCM token saved for user: ${user_id}`);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─────────────────────────── AI PROXY ─────────────────────────── */
/* Forwards /api/ai/predict from browser → Python backend on port 8000 */
/* This fixes the ERR_ADDRESS_INVALID error when browser tries to reach 0.0.0.0:8000 */

app.post('/api/ai/predict', async (req, res) => {
    const aiUrl = (process.env.AI_BACKEND_URL || 'http://localhost:8000').replace(/\/$/, '') + '/predict';
    try {
        const response = await fetch(aiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });
        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.error('❌  AI proxy error:', err.message);
        res.status(503).json({ mode: 'error', message: 'AI backend is not reachable. Make sure Python server is running on port 8000.' });
    }
});

/* ─────────────────────────── CONFIG ENDPOINT ─────────────────────────── */

app.get('/config', (req, res) => {
    res.json({
        aiBackendUrl: process.env.AI_BACKEND_URL || 'http://localhost:8000'
    });
});

/* ─────────────────────────── SERVE FRONTEND ─────────────────────────── */

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

/* ─────────────────────────── START ─────────────────────────── */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀  AI Health Assistant server running at http://localhost:${PORT}`);
    console.log(`📊  MongoDB: ${process.env.MONGO_URI ? 'Connected' : 'NOT SET'}`);
    const emailProvider = process.env.RESEND_API_KEY
        ? `✅ Resend HTTPS (${process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'})`
        : process.env.EMAIL_USER
            ? `⚠️  SMTP ${process.env.EMAIL_USER} — may timeout on Railway`
            : '❌ NOT CONFIGURED — add RESEND_API_KEY in Railway Variables';
    console.log(`✉️   Email: ${emailProvider}`);
    console.log(`📱  FCM: ${process.env.FIREBASE_PRIVATE_KEY ? '✅ Firebase ready' : '⚠️  FIREBASE_PRIVATE_KEY not set'}`);
    console.log(`🩺  Open http://localhost:${PORT} in your browser\n`);
});


