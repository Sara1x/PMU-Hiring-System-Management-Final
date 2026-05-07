import { BrowserRouter, Routes, Route } from 'react-router-dom';
import RoleSelection from './pages/RoleSelection';
import LoginPage from './pages/Login';
import VerifyEmailPage from './pages/VerifyEmail';

// Dean
import DeanDashboard from './pages/DeanDashboard';
import CreateRequisition from './pages/CreateRequisition';
import MyRequisitions from './pages/MyRequisitions';
import ShortlistedCandidates from './pages/ShortlistedCandidates';
import ChairRecommendations from './pages/ChairRecommendations';
import FinalDecisions from './pages/FinalDecisions';
import DeanSettings from './pages/DeanSettings';

// Chair
import ChairDashboard from './pages/ChairDashboard';
import AssignedRequisitions from './pages/AssignedRequisitions';
import CreateCommittee from './pages/CreateCommittee';
import EvaluationsOverview from './pages/EvaluationsOverview';
import ChairCandidateStatus from './pages/ChairCandidateStatus';
import ChairScheduleApprovals from './pages/ChairScheduleApprovals';
import ChairSettings from './pages/ChairSettings';

// HR
import HRDashboard from './pages/HRDashboard';
import HRRequisitions from './pages/HRRequisitions';
import CandidateManagement from './pages/CandidateManagement';
import ShortlistBuilder from './pages/ShortlistBuilder';
import InterviewScheduling from './pages/InterviewScheduling';
import HRSettings from './pages/HRSettings';

// Interviewer
import InterviewerDashboard from './pages/InterviewerDashboard';
import InterviewerMyCommittee from './pages/InterviewerMyCommittee';
import InterviewerEvaluationForm from './pages/InterviewerEvaluationForm';
import InterviewerCandidateStatus from './pages/InterviewerCandidateStatus';
import InterviewerSettings from './pages/InterviewerSettings';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RoleSelection />} />
        <Route path="/login/:role" element={<LoginPage />} />
        <Route path="/verify/:role" element={<VerifyEmailPage />} />

        {/* Dean */}
        <Route path="/dean/dashboard" element={<DeanDashboard />} />
        <Route path="/dean/create-requisition" element={<CreateRequisition />} />
        <Route path="/dean/my-requisitions" element={<MyRequisitions />} />
        <Route path="/dean/shortlisted-candidates" element={<ShortlistedCandidates />} />
        <Route path="/dean/chair-recommendations" element={<ChairRecommendations />} />
        <Route path="/dean/final-decisions" element={<FinalDecisions />} />
        <Route path="/dean/settings" element={<DeanSettings />} />

        {/* Chair */}
        <Route path="/chair/dashboard" element={<ChairDashboard />} />
        <Route path="/chair/assigned-requisitions" element={<AssignedRequisitions />} />
        <Route path="/chair/create-committee" element={<CreateCommittee />} />
        <Route path="/chair/schedule-approvals" element={<ChairScheduleApprovals />} />
        <Route path="/chair/evaluations-overview" element={<EvaluationsOverview />} />
        <Route path="/chair/candidate-status" element={<ChairCandidateStatus />} />
        <Route path="/chair/settings" element={<ChairSettings />} />

        {/* HR */}
        <Route path="/hr/dashboard" element={<HRDashboard />} />
        <Route path="/hr/requisitions" element={<HRRequisitions />} />
        <Route path="/hr/candidate-management" element={<CandidateManagement />} />
        <Route path="/hr/shortlist-builder" element={<ShortlistBuilder />} />
        <Route path="/hr/interview-scheduling" element={<InterviewScheduling />} />
        <Route path="/hr/settings" element={<HRSettings />} />

        {/* Interviewer */}
        <Route path="/interviewer/dashboard" element={<InterviewerDashboard />} />
        <Route path="/interviewer/my-committee" element={<InterviewerMyCommittee />} />
        <Route path="/interviewer/evaluation-form" element={<InterviewerEvaluationForm />} />
        <Route path="/interviewer/candidate-status" element={<InterviewerCandidateStatus />} />
        <Route path="/interviewer/settings" element={<InterviewerSettings />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
