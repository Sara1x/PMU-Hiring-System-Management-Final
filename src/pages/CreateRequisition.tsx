import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, setDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { DeanLayout } from '../components/DeanLayout';
import { getWorkflowStage } from '../utils/requisitionWorkflow';
import { STANDARD_DEPARTMENTS } from '../utils/requisitionFields';

const POSITION_TITLES = ['Assistant Professor', 'Associate Professor', 'Professor', 'Lecturer'];

export default function CreateRequisition() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    positionTitle: '',
    department: '',
    numberOfPositions: 1,
    expectedStartDate: '',
    jobDescription: '',
    requiredQualifications: '',
    keyResponsibilities: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const field = (key: keyof typeof form, value: string | number) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const handleSubmit = async () => {
    if (
      !form.positionTitle ||
      !form.department ||
      !form.numberOfPositions ||
      !form.expectedStartDate ||
      !form.jobDescription ||
      !form.requiredQualifications ||
      !form.keyResponsibilities
    ) {
      setError('Please fill in Position Title, Department, Number of Positions, Expected Start Date, Job Description, Required Qualifications, and Key Responsibilities.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const counterRef = doc(db, 'counters', 'requisitions');

      const requisitionId = await runTransaction(db, async (tx) => {
        const counterSnap = await tx.get(counterRef);
        const next = (counterSnap.exists() ? (counterSnap.data().current ?? 0) : 0) + 1;
        tx.set(counterRef, { current: next }, { merge: true });
        return `REQ-${String(next).padStart(3, '0')}`;
      });

      await setDoc(doc(db, 'requisitions', requisitionId), {
        requisitionId,
        positionTitle:          form.positionTitle,
        title:                  form.positionTitle,
        position:               form.positionTitle,
        department:             form.department,
        numberOfPositions:      form.numberOfPositions,
        expectedStartDate:      form.expectedStartDate,
        jobDescription:         form.jobDescription,
        requiredQualifications: form.requiredQualifications,
        keyResponsibilities:    form.keyResponsibilities,
        submittedBy:            'Dr. Abdullah Al-Zahrani',
        submittedAt:            serverTimestamp(),
        status:                 'Pending HR',
        workflowStage:          getWorkflowStage('Pending HR'),
        committeeCreated:       false,
        chairRating:            null,
        chairComment:           '',
        decision:               null,
      });

      navigate('/dean/my-requisitions');
    } catch (e) {
      console.error(e);
      setError('Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.7rem 0.9rem',
    border: '1px solid #d1d5db', borderRadius: '0.5rem',
    fontSize: '0.9rem', color: '#374151', outline: 'none',
    fontFamily: 'inherit', boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '0.85rem', fontWeight: '500',
    color: '#374151', marginBottom: '0.4rem',
  };

  const sectionStyle: React.CSSProperties = {
    backgroundColor: 'white', borderRadius: '0.875rem',
    padding: '1.75rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
    marginBottom: '1.25rem',
  };

  return (
    <DeanLayout>
      <h1 style={{ fontSize: '1.6rem', fontWeight: '700', color: '#111827', marginBottom: '0.25rem' }}>
        Create New Job Requisition
      </h1>
      <p style={{ color: '#6b7280', fontSize: '0.9rem', marginBottom: '1.75rem' }}>
        Fill out the form below to create a new faculty position requisition
      </p>

      {/* Position Details */}
      <div style={sectionStyle}>
        <h2 style={{ fontSize: '1.05rem', fontWeight: '700', color: '#111827', marginBottom: '1.25rem' }}>
          Position Details
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.25rem' }}>
          <div>
            <label style={labelStyle}>Position Title *</label>
            <select style={inputStyle} value={form.positionTitle} onChange={e => field('positionTitle', e.target.value)}>
              <option value="">Select Position Title</option>
              {POSITION_TITLES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Department *</label>
            <select style={inputStyle} value={form.department} onChange={e => field('department', e.target.value)}>
              <option value="">Select Department</option>
              {STANDARD_DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
          <div>
            <label style={labelStyle}>Number of Positions *</label>
            <input style={inputStyle} type="number" min={1} value={form.numberOfPositions}
              onChange={e => field('numberOfPositions', Number(e.target.value))} />
          </div>
          <div>
            <label style={labelStyle}>Expected Start Date *</label>
            <input style={inputStyle} type="date" value={form.expectedStartDate}
              onChange={e => field('expectedStartDate', e.target.value)} />
          </div>
        </div>
      </div>

      {/* Position Description */}
      <div style={sectionStyle}>
        <h2 style={{ fontSize: '1.05rem', fontWeight: '700', color: '#111827', marginBottom: '1.25rem' }}>
          Position Description
        </h2>

        <div style={{ marginBottom: '1.25rem' }}>
          <label style={labelStyle}>Job Description *</label>
          <textarea
            style={{ ...inputStyle, height: '120px', resize: 'vertical' }}
            placeholder="Provide a detailed description of the position..."
            value={form.jobDescription}
            onChange={e => field('jobDescription', e.target.value)}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
          <div>
            <label style={labelStyle}>Required Qualifications *</label>
            <textarea
              style={{ ...inputStyle, height: '140px', resize: 'vertical' }}
              placeholder="List required qualifications..."
              value={form.requiredQualifications}
              onChange={e => field('requiredQualifications', e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Key Responsibilities *</label>
            <textarea
              style={{ ...inputStyle, height: '140px', resize: 'vertical' }}
              placeholder="List key responsibilities..."
              value={form.keyResponsibilities}
              onChange={e => field('keyResponsibilities', e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <p style={{ color: '#dc2626', fontSize: '0.875rem', marginBottom: '1rem', textAlign: 'right' }}>{error}</p>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
        <button
          onClick={() => navigate('/dean/my-requisitions')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.7rem 1.5rem', background: 'none', border: '1px solid #d1d5db', borderRadius: '0.5rem', color: '#374151', fontSize: '0.9rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          ✕ Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          style={{ padding: '0.7rem 1.75rem', backgroundColor: submitting ? '#9ca3af' : '#002147', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.9rem', fontWeight: '600', cursor: submitting ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
          onMouseEnter={e => { if (!submitting) e.currentTarget.style.backgroundColor = '#003366'; }}
          onMouseLeave={e => { if (!submitting) e.currentTarget.style.backgroundColor = '#002147'; }}
        >
          {submitting ? 'Submitting…' : 'Submit Requisition'}
        </button>
      </div>
    </DeanLayout>
  );
}
