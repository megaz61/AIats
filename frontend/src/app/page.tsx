"use client";

import React, { useEffect, useState } from "react";

interface Job {
  id: number;
  title: string;
}

interface Candidate {
  id: number;
  name: string;
  email: string;
  skills: string;
  education: string | null;
  experience_details: string | null;
  projects: string | null;
  experience_years: number;
  match_score: number | null;
  score_breakdown: string | null;
  ai_summary: string | null;
  job_id: number;
  resume_url: string | null;
}

export default function Dashboard() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterJobId, setFilterJobId] = useState<number | "all">("all");
  const [candidateToDelete, setCandidateToDelete] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [cvUrlToView, setCvUrlToView] = useState<string | null>(null);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [expandedCandidateId, setExpandedCandidateId] = useState<number | null>(null);

  const toggleExpand = (id: number) => {
    setExpandedCandidateId(prev => prev === id ? null : id);
  };

  const handleDeleteCandidate = async () => {
    if (candidateToDelete === null) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/candidates/${candidateToDelete}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setCandidates(prev => prev.filter(c => c.id !== candidateToDelete));
      } else {
        alert("Failed to delete candidate");
      }
    } catch (err) {
      console.error(err);
      alert("Error deleting candidate");
    } finally {
      setIsDeleting(false);
      setCandidateToDelete(null);
    }
  };

  const closeCvViewer = () => {
    if (cvUrlToView && cvUrlToView.startsWith('blob:')) {
      URL.revokeObjectURL(cvUrlToView);
    }
    setCvUrlToView(null);
    setIsLoadingPdf(false);
  };

  const handleViewCv = async (resumeUrl: string) => {
    try {
      setIsLoadingPdf(true);
      if (!resumeUrl) throw new Error("Resume URL is missing");
      
      const baseUrl = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:8000';
      const filename = resumeUrl.split('/').pop()?.replace('.pdf', '') || '';
      
      // Bypassing IDM by requesting JSON base64 instead of a raw .pdf URL
      const bypassUrl = `${baseUrl}/api/candidates/cv/${filename}/base64`;
      
      const response = await fetch(bypassUrl, {
        method: "GET",
        headers: { "Accept": "application/json" },
      });
      
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      
      const json = await response.json();
      if (!json.data) throw new Error("Invalid base64 response from server");
      
      // Convert base64 string back to binary Blob
      const byteCharacters = atob(json.data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });
      
      const blobUrl = URL.createObjectURL(blob);
      setCvUrlToView(blobUrl);
    } catch (error) {
      console.error("Failed to load PDF:", error);
      alert("Gagal memuat PDF. Pastikan server backend berjalan dan URL benar.");
    } finally {
      setIsLoadingPdf(false);
    }
  };

  useEffect(() => {
    Promise.all([
      fetch(`${process.env.NEXT_PUBLIC_API_URL}/jobs/`).then(res => res.json()),
      fetch(`${process.env.NEXT_PUBLIC_API_URL}/candidates/`).then(res => res.json())
    ])
      .then(([jobsData, candidatesData]) => {
        setJobs(jobsData);
        setCandidates(candidatesData);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to fetch data", err);
        setLoading(false);
      });
  }, []);

  const getScoreColor = (score: number | null) => {
    if (score === null) return "bg-slate-100 text-slate-800 border-slate-200";
    if (score >= 80) return "bg-green-50 text-green-700 border-green-200";
    if (score >= 50) return "bg-yellow-50 text-yellow-700 border-yellow-200";
    return "bg-red-50 text-red-700 border-red-200";
  };
  
  const getJobTitle = (jobId: number) => {
    const job = jobs.find(j => j.id === jobId);
    return job ? job.title : "Unknown Job";
  };

  const filteredCandidates = filterJobId === "all" 
    ? candidates 
    : candidates.filter(c => c.job_id === filterJobId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Candidates Ranking</h1>
          <p className="mt-2 text-sm text-slate-500">
            Review and manage applicants. Ranked by AI-powered match score.
          </p>
        </div>
        
        <div className="flex items-center space-x-3 bg-white/60 p-2 rounded-xl border border-slate-200/60 shadow-sm backdrop-blur-sm">
          <label className="text-sm font-medium text-slate-600 pl-2">Filter by Job:</label>
          <select
            className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            value={filterJobId}
            onChange={(e) => setFilterJobId(e.target.value === "all" ? "all" : Number(e.target.value))}
          >
            <option value="all">All Jobs</option>
            {jobs.map(job => (
              <option key={job.id} value={job.id}>{job.title}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Quick Guide */}
      <div className="bg-indigo-50/50 backdrop-blur-sm border border-indigo-100/60 rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-indigo-900 flex items-center gap-2 mb-3">
          <span>🚀</span> Quick Guide: How to Use the AI ATS
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-indigo-800/80">
          <div className="flex gap-2">
            <span className="font-bold text-indigo-600">1.</span>
            <p><strong className="text-indigo-900">Define the Role:</strong> Go to the &quot;Manage Jobs&quot; page to add a new job posting and define the required skills or criteria.</p>
          </div>
          <div className="flex gap-2">
            <span className="font-bold text-indigo-600">2.</span>
            <p><strong className="text-indigo-900">Upload Resumes:</strong> Navigate to the &quot;Upload CV&quot; page to process candidates. You can batch upload up to 15 PDF files at once.</p>
          </div>
          <div className="flex gap-2">
            <span className="font-bold text-indigo-600">3.</span>
            <p><strong className="text-indigo-900">Review Matches:</strong> Return to this Dashboard to see the ranked candidates. The system automatically calculates the Match Score and generates an AI Summary.</p>
          </div>
          <div className="flex gap-2">
            <span className="font-bold text-indigo-600">4.</span>
            <p><strong className="text-indigo-900">View Details:</strong> Click the down arrow (expand icon) in the Action column to read the detailed AI Summary for each candidate.</p>
          </div>
        </div>
        <div className="mt-4 p-3 bg-amber-50/80 border border-amber-200/60 rounded-xl text-xs text-amber-800 flex items-start gap-2 leading-relaxed">
          <span className="text-sm">⚠️</span>
          <p><strong>Disclaimer:</strong> This system is currently under active development. The Match Score and AI Summary are designed to assist the screening process, but they may have limitations. Recruiters are highly advised to manually review the original CVs to ensure absolute accuracy before making hiring decisions.</p>
        </div>
      </div>

      <div className="glass-panel rounded-2xl overflow-hidden border border-white/40 shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200/50">
            <thead className="bg-slate-50/50">
              <tr>
                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Candidate</th>
                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Applied For</th>
                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Experience</th>
                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Match Score</th>
                <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/50 bg-white/40">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-sm text-slate-500">Loading data...</td>
                </tr>
              ) : filteredCandidates.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-sm text-slate-500">No candidates found for this filter.</td>
                </tr>
              ) : (
                filteredCandidates.map((candidate) => (
                  <React.Fragment key={candidate.id}>
                  <tr className="hover:bg-white/60 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-slate-900">{candidate.name}</span>
                        <span className="text-sm text-slate-500">{candidate.email}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 text-xs font-medium border border-slate-200">
                        {getJobTitle(candidate.job_id)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-slate-700">{candidate.experience_years} years</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${getScoreColor(candidate.match_score)}`}>
                        {candidate.match_score !== null ? `${candidate.match_score}%` : "N/A"}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                      <button
                        onClick={() => toggleExpand(candidate.id)}
                        className="text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 p-2 rounded-lg transition-colors inline-block"
                        title="View AI Analysis"
                      >
                        <svg className={`w-5 h-5 transform transition-transform ${expandedCandidateId === candidate.id ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </button>
                      {candidate.resume_url && (
                        <button 
                          onClick={() => handleViewCv(candidate.resume_url!)}
                          className="text-indigo-500 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 p-2 rounded-lg transition-colors inline-block"
                          title="View CV"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        </button>
                      )}
                      <button 
                        onClick={() => setCandidateToDelete(candidate.id)}
                        className="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 p-2 rounded-lg transition-colors inline-block"
                        title="Delete Candidate"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </td>
                  </tr>
                  {expandedCandidateId === candidate.id && (
                    <tr>
                      <td colSpan={5} className="px-6 py-4 bg-slate-50 border-b border-slate-200">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div>
                            <h4 className="text-sm font-semibold text-slate-900 mb-2">AI Summary</h4>
                            <p className="text-sm text-slate-700 bg-white p-4 rounded-xl border border-slate-200 shadow-sm leading-relaxed">
                              {candidate.ai_summary || "Tidak ada ringkasan AI."}
                            </p>
                            
                            {candidate.score_breakdown && (
                              <div className="mt-4">
                                <h4 className="text-sm font-semibold text-slate-900 mb-2">Score Breakdown</h4>
                                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-2">
                                  {(() => {
                                    try {
                                      const breakdown = JSON.parse(candidate.score_breakdown);
                                      return (
                                        <>
                                          <div className="flex justify-between text-sm"><span className="text-slate-500">Semantic Score:</span> <span className="font-medium">{breakdown.semantic_score}%</span></div>
                                          <div className="flex justify-between text-sm"><span className="text-slate-500">Skill Match:</span> <span className="font-medium">{breakdown.skill_match}%</span></div>
                                          <div className="flex justify-between text-sm"><span className="text-slate-500">Experience Match:</span> <span className="font-medium">{breakdown.experience_match}%</span></div>
                                        </>
                                      );
                                    } catch (e) {
                                      return <span className="text-sm text-slate-500">Invalid data</span>;
                                    }
                                  })()}
                                </div>
                              </div>
                            )}
                          </div>
                          
                          {candidate.score_breakdown && (
                            <div>
                              {(() => {
                                try {
                                  const breakdown = JSON.parse(candidate.score_breakdown);
                                  return (
                                    <div className="space-y-4">
                                      <div>
                                        <h4 className="text-sm font-semibold text-green-700 mb-2 flex items-center gap-1">
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                          Matched Skills
                                        </h4>
                                        <div className="flex flex-wrap gap-2">
                                          {breakdown.matched_skills && breakdown.matched_skills.length > 0 ? breakdown.matched_skills.map((s: string, i: number) => (
                                            <span key={i} className="px-2 py-1 bg-green-50 text-green-700 text-xs rounded-md border border-green-200">{s}</span>
                                          )) : <span className="text-sm text-slate-500">None</span>}
                                        </div>
                                      </div>
                                      <div>
                                        <h4 className="text-sm font-semibold text-red-700 mb-2 flex items-center gap-1">
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                          Missing Skills
                                        </h4>
                                        <div className="flex flex-wrap gap-2">
                                          {breakdown.missing_skills && breakdown.missing_skills.length > 0 ? breakdown.missing_skills.map((s: string, i: number) => (
                                            <span key={i} className="px-2 py-1 bg-red-50 text-red-700 text-xs rounded-md border border-red-200">{s}</span>
                                          )) : <span className="text-sm text-slate-500">None</span>}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                } catch (e) {
                                  return null;
                                }
                              })()}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {candidateToDelete !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl border border-slate-100">
            <h3 className="text-lg font-bold text-slate-900 mb-2">Delete Candidate</h3>
            <p className="text-slate-500 mb-6">Yakin ingin menghapus kandidat ini? Data yang dihapus tidak dapat dikembalikan.</p>
            <div className="flex justify-end space-x-3">
              <button 
                onClick={() => setCandidateToDelete(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                disabled={isDeleting}
              >
                Batal
              </button>
              <button 
                onClick={handleDeleteCandidate}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors flex items-center"
                disabled={isDeleting}
              >
                {isDeleting ? "Menghapus..." : "Hapus"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* CV Viewer Modal */}
      {(cvUrlToView !== null || isLoadingPdf) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-full max-w-4xl h-[90vh] shadow-2xl border border-slate-100 flex flex-col overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-slate-200">
              <h3 className="text-lg font-bold text-slate-900">View CV</h3>
              <button 
                onClick={closeCvViewer}
                className="text-slate-400 hover:text-red-500 transition-colors p-1"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 w-full bg-slate-100 relative">
              {isLoadingPdf ? (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-100 z-10">
                  <div className="flex flex-col items-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
                    <p className="text-slate-500 font-medium">Memuat dokumen PDF...</p>
                  </div>
                </div>
              ) : (
                <object 
                  data={`${cvUrlToView}#view=FitH`} 
                  type="application/pdf"
                  className="w-full h-full border-0"
                >
                  <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                    <p className="text-slate-600 mb-4">Browser Anda tidak mendukung preview PDF langsung.</p>
                    <a href={cvUrlToView || "#"} download className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                      Download PDF
                    </a>
                  </div>
                </object>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
