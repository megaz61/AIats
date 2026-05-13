"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Job {
  id: number;
  title: string;
}

interface FileStatus {
  file: File;
  status: 'pending' | 'uploading' | 'success' | 'error';
  message?: string;
}

export default function UploadPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<number | "">("");
  
  const [isDragging, setIsDragging] = useState(false);
  const [fileQueue, setFileQueue] = useState<FileStatus[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [apiLimitError, setApiLimitError] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Fetch available jobs
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/jobs/`)
      .then(res => res.json())
      .then(data => {
        setJobs(data);
        if (data.length > 0) {
          setSelectedJobId(data[0].id);
        }
      })
      .catch(err => console.error("Failed to fetch jobs", err));
  }, []);

  const MAX_FILES = 15;
  const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB

  const handleFiles = (newFiles: FileList | File[]) => {
    if (isUploading) return;
    
    const validFiles = Array.from(newFiles).filter(f => f.type === "application/pdf");
    
    if (validFiles.length !== newFiles.length) {
      alert("Only PDF files are allowed.");
    }
    
    setFileQueue(prev => {
      const combined = [...prev, ...validFiles.map(f => ({ file: f, status: 'pending' as const }))];
      
      // Limit to max files
      if (combined.length > MAX_FILES) {
        alert(`Maximum ${MAX_FILES} files allowed. Some files were discarded.`);
        return combined.slice(0, MAX_FILES);
      }
      
      // Check total size
      const totalSize = combined.reduce((acc, curr) => acc + curr.file.size, 0);
      if (totalSize > MAX_TOTAL_SIZE) {
        alert(`Total size exceeds 50MB limit. Cannot add these files.`);
        return prev;
      }
      
      return combined;
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
  };

  const removeFile = (index: number) => {
    if (isUploading) return;
    setFileQueue(prev => prev.filter((_, i) => i !== index));
  };

  // Returns true on success, false on failure
  const uploadSingleFile = async (fileStatus: FileStatus, index: number): Promise<boolean> => {
    setFileQueue(prev => prev.map((item, i) => i === index ? { ...item, status: 'uploading', message: 'Extracting data...' } : item));
    
    try {
      const formData = new FormData();
      formData.append("file", fileStatus.file);
      
      const uploadRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/candidates/upload-cv`, {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) {
        const errJson = await uploadRes.json().catch(() => ({ detail: "Server error" }));
        // Check if it's an API rate-limit error (503 + api_limit flag)
        if (uploadRes.status === 503 && errJson?.detail?.error_type === "api_limit") {
          setApiLimitError(true);
          throw new Error(errJson.detail.message || "API limit reached.");
        }
        const errMsg = typeof errJson.detail === "object" ? errJson.detail.message : (errJson.detail || "Failed to extract CV");
        throw new Error(errMsg);
      }
      const uploadData = await uploadRes.json();
      const extractedData = uploadData.extracted_data;
      
      setFileQueue(prev => prev.map((item, i) => i === index ? { ...item, message: 'Saving candidate...' } : item));
      
      const finalEmail = (extractedData.email && extractedData.email.includes('@') && !extractedData.email.toLowerCase().includes('unknown'))
        ? extractedData.email
        : `candidate_${Date.now()}_${Math.floor(Math.random() * 1000)}@example.com`;

      const candidatePayload = {
        name: extractedData.name || "Unknown Candidate",
        email: finalEmail,
        skills: JSON.stringify(extractedData.skills || []),
        education: JSON.stringify(extractedData.education || []),
        experience_details: JSON.stringify(extractedData.experience_details || []),
        projects: JSON.stringify(extractedData.projects || []),
        experience_years: extractedData.total_experience_years || 0,
        job_id: Number(selectedJobId),
        resume_url: uploadData.resume_url || ""
      };
      
      const createRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/candidates/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(candidatePayload),
      });
      if (!createRes.ok) throw new Error("Failed to save candidate to database");
      const createdCandidate = await createRes.json();
      
      setFileQueue(prev => prev.map((item, i) => i === index ? { ...item, message: 'Calculating match score...' } : item));
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/candidates/${createdCandidate.id}/calculate-match`, {
        method: "POST",
      });
      
      setFileQueue(prev => prev.map((item, i) => i === index ? { ...item, status: 'success', message: 'Done!' } : item));
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error processing file';
      console.error(`File ${index + 1} failed:`, error);
      setFileQueue(prev => prev.map((item, i) => i === index ? { ...item, status: 'error', message } : item));
      return false;
    }
  };

  const handleSubmit = async () => {
    if (fileQueue.length === 0) return;
    if (selectedJobId === "") {
      alert("Please select a job first.");
      return;
    }
    setApiLimitError(false);
    
    const totalSize = fileQueue.reduce((acc, curr) => acc + curr.file.size, 0);
    if (totalSize > MAX_TOTAL_SIZE) {
      alert("Total size exceeds 50MB limit. Please remove some files.");
      return;
    }
    
    setIsUploading(true);
    
    // Snapshot the queue to avoid stale closure issues inside the loop.
    // We use the snapshot to determine which files to process and pass
    // the correct file object to uploadSingleFile. Results are tracked
    // locally via successCount — NOT via the fileQueue state (which is async).
    const snapshotQueue = [...fileQueue];
    let successCount = 0;
    
    for (let i = 0; i < snapshotQueue.length; i++) {
      if (snapshotQueue[i].status === 'success') {
        successCount++;
        continue;
      }
      
      const ok = await uploadSingleFile(snapshotQueue[i], i);
      if (ok) successCount++;
      
      // Add delay between files to avoid rate limiting from Hugging Face API
      if (i < snapshotQueue.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    
    setIsUploading(false);
    
    // Only redirect if every file was successfully processed
    if (successCount === snapshotQueue.length) {
      setTimeout(() => {
        router.push("/");
      }, 2000);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 mt-10">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Upload CV (Bulk)</h1>
        <p className="mt-2 text-slate-500">
          Upload up to 15 PDFs (Max 50MB) to automatically extract data and calculate match score.
        </p>
      </div>

      {/* API Limit Disclaimer Banner */}
      {apiLimitError && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-300 rounded-2xl shadow-sm">
          <span className="text-xl flex-shrink-0">⚠️</span>
          <div>
            <p className="font-semibold text-amber-800 text-sm">Gagal Menganalisis CV</p>
            <p className="text-amber-700 text-sm mt-0.5">
              Limit API gratis dari developer mungkin sedang habis. Silakan coba beberapa saat lagi.
            </p>
          </div>
          <button
            onClick={() => setApiLimitError(false)}
            className="ml-auto text-amber-500 hover:text-amber-700 flex-shrink-0"
            aria-label="Tutup notifikasi"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <div className="glass-panel p-6 rounded-2xl border border-white/40 shadow-sm">
        <label className="block text-sm font-medium text-slate-700 mb-2">Select Job Opening</label>
        <select 
          className="w-full px-4 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all bg-white/50"
          value={selectedJobId}
          onChange={(e) => setSelectedJobId(e.target.value === "" ? "" : Number(e.target.value))}
          disabled={isUploading}
        >
          <option value="" disabled>-- Select a Job --</option>
          {jobs.map(job => (
            <option key={job.id} value={job.id}>{job.title}</option>
          ))}
        </select>
        {jobs.length === 0 && (
          <p className="text-xs text-red-500 mt-2">No jobs available. Please create a job in Manage Jobs first.</p>
        )}
      </div>

      <div 
        className={`glass-panel border-2 border-dashed rounded-3xl p-8 sm:p-12 transition-all duration-200 text-center
          ${isDragging ? 'border-indigo-500 bg-indigo-50/30' : 'border-slate-300 hover:border-indigo-400'}
          ${isUploading ? 'opacity-70 pointer-events-none' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isUploading && fileInputRef.current?.click()}
      >
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleFileChange} 
          accept=".pdf" 
          multiple
          className="hidden" 
        />
        
        <div className="space-y-4 cursor-pointer">
          <div className="w-16 h-16 bg-slate-100 text-slate-500 rounded-2xl flex items-center justify-center mx-auto mb-4 hover:bg-indigo-50 hover:text-indigo-500 transition-colors">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
          </div>
          <p className="text-slate-700 font-medium">Click to upload or drag and drop</p>
          <p className="text-sm text-slate-500">PDF up to 50MB total</p>
        </div>
      </div>

      {fileQueue.length > 0 && (
        <div className="glass-panel p-6 rounded-2xl border border-white/40 shadow-sm space-y-4">
          <div className="flex justify-between items-center border-b border-slate-200/50 pb-2">
            <h3 className="font-semibold text-slate-800">Files ({fileQueue.length}/{MAX_FILES})</h3>
            <span className="text-sm text-slate-500">
              {(fileQueue.reduce((acc, curr) => acc + curr.file.size, 0) / 1024 / 1024).toFixed(2)} MB / 50 MB
            </span>
          </div>
          
          <div className="space-y-3 max-h-64 overflow-y-auto pr-2">
            {fileQueue.map((item, index) => (
              <div key={index} className="flex items-center justify-between bg-white/40 p-3 rounded-xl border border-slate-100">
                <div className="flex items-center space-x-3 overflow-hidden">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
                    ${item.status === 'success' ? 'bg-green-100 text-green-600' : 
                      item.status === 'error' ? 'bg-red-100 text-red-600' : 
                      item.status === 'uploading' ? 'bg-indigo-100 text-indigo-600 animate-pulse' : 'bg-slate-100 text-slate-500'}`}>
                    {item.status === 'success' ? <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> :
                     item.status === 'error' ? <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg> :
                     item.status === 'uploading' ? <div className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div> :
                     <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
                  </div>
                  <div className="truncate">
                    <p className="text-sm font-medium text-slate-800 truncate">{item.file.name}</p>
                    <p className="text-xs text-slate-500">
                      {item.status === 'pending' ? `${(item.file.size / 1024 / 1024).toFixed(2)} MB` : item.message}
                    </p>
                  </div>
                </div>
                {!isUploading && item.status !== 'success' && (
                  <button onClick={() => removeFile(index)} className="text-slate-400 hover:text-red-500 p-1">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
              </div>
            ))}
          </div>
          
          <div className="pt-4 flex justify-end space-x-3">
            <button 
              onClick={() => setFileQueue([])}
              disabled={isUploading || fileQueue.length === 0}
              className="px-6 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
            >
              Clear All
            </button>
            <button 
              onClick={handleSubmit}
              disabled={isUploading || fileQueue.length === 0 || selectedJobId === ""}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-2 rounded-xl font-medium transition-colors shadow-sm disabled:opacity-50 flex items-center space-x-2"
            >
              {isUploading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>Processing...</span>
                </>
              ) : (
                <span>Process {fileQueue.length} CV{fileQueue.length > 1 ? 's' : ''}</span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
