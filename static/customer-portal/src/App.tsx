import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useParams, useNavigate } from 'react-router-dom';
import { invoke } from '@forge/bridge';
import { Briefcase, ChevronRight, HardDrive, Shield, HelpCircle } from 'lucide-react';
import './index.css';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Department {
  id: string;
  name: string;
  icon?: string;
  color: string;
}

interface RequestType {
  id: string;
  name: string;
  description: string;
  icon?: string;
}

// ─── Main App ───────────────────────────────────────────────────────────────

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-container">
        <header className="header">
          <Shield size={28} color="#3B82F6" />
          <div className="header-title">Enterprise Service Desk</div>
        </header>

        <main className="main-content fade-in">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/dept/:deptId" element={<DepartmentPage />} />
            <Route path="/dept/:deptId/request/:requestTypeId" element={<RequestFormPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

// ─── Home Page ──────────────────────────────────────────────────────────────

function Home() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<Department[]>('getDepartments')
      .then((res: any) => setDepartments(res))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loader />;

  return (
    <div>
      <h1>What do you need help with?</h1>
      <p className="subtitle">Select a department below to get started.</p>

      <div className="grid-cards">
        {departments.map((dept) => (
          <Link key={dept.id} to={`/dept/${dept.id}`} className="card-link">
            <div className="glass-card">
              <div className="dept-icon" style={{ color: dept.color, backgroundColor: `${dept.color}22` }}>
                <Icon name={dept.icon} />
              </div>
              <div className="card-title">{dept.name}</div>
              <div className="card-desc">Get support from the {dept.name} team</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── Department Page ────────────────────────────────────────────────────────

function DepartmentPage() {
  const { deptId } = useParams<{ deptId: string }>();
  const [requestTypes, setRequestTypes] = useState<RequestType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (deptId) {
      invoke<RequestType[]>('getRequestTypes', { deptId })
        .then((res: any) => setRequestTypes(res))
        .finally(() => setLoading(false));
    }
  }, [deptId]);

  if (loading) return <Loader />;

  return (
    <div>
      <Link to="/" style={{ color: 'var(--accent-primary)', textDecoration: 'none', marginBottom: '1rem', display: 'inline-block' }}>
        ← Back to Departments
      </Link>
      <h1>Select a Request Type</h1>

      <div className="grid-cards">
        {requestTypes.map((rt) => (
          <Link key={rt.id} to={`/dept/${deptId}/request/${rt.id}`} className="card-link">
            <div className="glass-card">
              <div className="card-title">{rt.name}</div>
              <div className="card-desc">{rt.description}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── Dynamic Form Page ──────────────────────────────────────────────────────

function RequestFormPage() {
  const { deptId, requestTypeId } = useParams<{ deptId: string; requestTypeId: string }>();
  const navigate = useNavigate();
  const [formDef, setFormDef] = useState<any>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (deptId && requestTypeId) {
      invoke('getFormDefinition', { deptId, requestTypeId })
        .then((res: any) => setFormDef(res))
        .finally(() => setLoading(false));
    }
  }, [deptId, requestTypeId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    // Submit logic would go here, calling a resolver to create the Jira issue
    setTimeout(() => {
      alert('Request submitted successfully!');
      navigate('/');
    }, 1000);
  };

  if (loading) return <Loader />;
  if (!formDef) return <div>Form not found.</div>;

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto' }}>
      <Link to={`/dept/${deptId}`} style={{ color: 'var(--accent-primary)', textDecoration: 'none', marginBottom: '1rem', display: 'inline-block' }}>
        ← Back
      </Link>
      
      <div className="glass-card">
        <h2 style={{ marginBottom: '2rem' }}>Complete your request</h2>
        
        <form onSubmit={handleSubmit}>
          {formDef.fields.map((field: any) => (
            <DynamicField
              key={field.id}
              field={field}
              value={formData[field.id]}
              allValues={formData}
              onChange={(val: any) => setFormData((prev) => ({ ...prev, [field.id]: val }))}
            />
          ))}

          <button type="submit" className="btn-primary" disabled={submitting} style={{ marginTop: '2rem' }}>
            {submitting ? 'Submitting...' : 'Submit Request'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Dynamic Field Component ────────────────────────────────────────────────

function DynamicField({ field, value, allValues, onChange }: any) {
  const [options, setOptions] = useState<{ value: string; label: string }[]>(field.options || []);
  const [loadingOpts, setLoadingOpts] = useState(false);

  useEffect(() => {
    if (field.type.startsWith('dynamic-') || field.type === 'cascading-select') {
      const dependsOnVal = field.dependsOn ? allValues[field.dependsOn] : undefined;
      
      if (field.dependsOn && !dependsOnVal) {
        setOptions([]); // Wait for dependency
        return;
      }

      setLoadingOpts(true);
      invoke('getFieldOptions', {
        apiSourceId: field.apiSourceId,
        apiPath: field.apiPath,
        dependsOnValue: dependsOnVal,
        valueKey: field.valueKey,
        labelKey: field.labelKey,
      })
        .then((res: any) => setOptions(res.options))
        .catch((err) => console.error('Failed to load options', err))
        .finally(() => setLoadingOpts(false));
    }
  }, [field, allValues[field.dependsOn]]);

  return (
    <div className="form-group">
      <label className="form-label">
        {field.label} {field.required && <span style={{ color: 'var(--danger)' }}>*</span>}
      </label>

      {field.type === 'textarea' ? (
        <textarea
          className="form-textarea"
          required={field.required}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
      ) : field.type.includes('select') ? (
        <select
          className="form-select"
          required={field.required}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={loadingOpts}
        >
          <option value="">{loadingOpts ? 'Loading options...' : 'Select an option'}</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={field.type === 'number' ? 'number' : 'text'}
          className="form-input"
          required={field.required}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function Loader() {
  return (
    <div className="loader-container">
      <div className="spinner">
        <Shield size={40} color="var(--accent-primary)" />
      </div>
      <div>Loading...</div>
    </div>
  );
}

function Icon({ name }: { name?: string }) {
  if (name === 'hard-drive') return <HardDrive size={24} />;
  if (name === 'briefcase') return <Briefcase size={24} />;
  return <HelpCircle size={24} />;
}
