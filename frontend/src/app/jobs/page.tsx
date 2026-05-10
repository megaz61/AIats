"use client";

import { useEffect, useState } from "react";

interface Job {
  id: number;
  title: string;
  description: string;
  created_at: string;
}

export default function ManageJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [isEditing, setIsEditing] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchJobs = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/jobs/`);
      const data = await res.json();
      setJobs(data);
    } catch (err) {
      console.error("Failed to fetch jobs", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  const resetForm = () => {
    setIsEditing(false);
    setCurrentJobId(null);
    setTitle("");
    setDescription("");
  };

  const handleEdit = (job: Job) => {
    setIsEditing(true);
    setCurrentJobId(job.id);
    setTitle(job.title);
    setDescription(job.description);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this job?")) return;

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/jobs/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchJobs();
      } else {
        alert("Failed to delete job.");
      }
    } catch (err) {
      console.error(err);
      alert("Error deleting job.");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const payload = { title, description };

    try {
      let url = `${process.env.NEXT_PUBLIC_API_URL}/jobs/`;
      let method = "POST";

      if (isEditing && currentJobId) {
        url = `${process.env.NEXT_PUBLIC_API_URL}/jobs/${currentJobId}`;
        method = "PUT";
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        fetchJobs();
        resetForm();
      } else {
        alert("Failed to save job.");
      }
    } catch (err) {
      console.error(err);
      alert("Error saving job.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Manage Jobs</h1>
        <p className="mt-2 text-sm text-slate-500">
          Create, update, or delete job postings and their criteria.
        </p>
      </div>

      {/* List Section */}
      <div className="glass-panel rounded-2xl overflow-hidden border border-white/40 shadow-sm">
        <div className="p-6 border-b border-slate-200/50">
          <h2 className="text-lg font-semibold text-slate-800">Active Jobs</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200/50">
            <thead className="bg-slate-50/50">
              <tr>
                <th scope="col" className="px-4 sm:px-6 py-3 sm:py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-1/4">Title</th>
                <th scope="col" className="px-4 sm:px-6 py-3 sm:py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-1/2">Description</th>
                <th scope="col" className="px-4 sm:px-6 py-3 sm:py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-1/4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/50 bg-white/40">
              {loading ? (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-sm text-slate-500">Loading jobs...</td>
                </tr>
              ) : jobs.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-sm text-slate-500">No jobs found. Create one above.</td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-white/60 transition-colors">
                    <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                      <span className="text-sm font-medium text-slate-900">{job.title}</span>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                      <p className="text-sm text-slate-600 line-clamp-2">{job.description}</p>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-right space-x-3">
                      <button
                        onClick={() => handleEdit(job)}
                        className="text-sm font-medium text-indigo-600 hover:text-indigo-900"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(job.id)}
                        className="text-sm font-medium text-red-600 hover:text-red-900"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Form Section */}
      <div className="glass-panel p-6 rounded-2xl border border-white/40 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">
          {isEditing ? "Edit Job" : "Create New Job"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Job Title</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all bg-white/50"
              placeholder="e.g. IT Programmer"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Criteria & Description</label>
            <textarea
              required
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all bg-white/50"
              placeholder="List the required skills, experience, etc."
            />
          </div>
          <div className="flex space-x-3 pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-xl font-medium transition-colors shadow-sm disabled:opacity-50"
            >
              {isSubmitting ? "Saving..." : isEditing ? "Update Job" : "Save Job"}
            </button>
            {isEditing && (
              <button
                type="button"
                onClick={resetForm}
                className="bg-slate-200 hover:bg-slate-300 text-slate-800 px-6 py-2 rounded-xl font-medium transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
