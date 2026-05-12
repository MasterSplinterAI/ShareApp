import { useEffect, useState, useRef } from 'react';
import toast from 'react-hot-toast';
import { v2Files } from '../../services/apiV2';

export default function V2FilesPage() {
  const [files, setFiles] = useState([]);
  const [meetingId, setMeetingId] = useState('');
  const inputRef = useRef(null);

  const load = () => {
    v2Files
      .list()
      .then((r) => setFiles(r.files || []))
      .catch(() => toast.error('Failed to list files'));
  };

  useEffect(() => {
    load();
  }, []);

  const upload = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    if (meetingId.trim()) fd.append('meeting_id', meetingId.trim());
    try {
      await v2Files.upload(fd);
      toast.success('Uploaded');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed');
    }
    e.target.value = '';
  };

  const download = (f) => {
    const token = localStorage.getItem('v2_token');
    fetch(v2Files.downloadUrl(f.id), { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = f.original_name;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => toast.error('Download failed'));
  };

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold text-white mb-2">Files</h1>
      <p className="text-gray-500 text-sm mb-6">Org-scoped uploads (images, PDF, text). Optional meeting ID for ACL.</p>
      <div className="space-y-3 mb-6">
        <input
          value={meetingId}
          onChange={(e) => setMeetingId(e.target.value)}
          placeholder="Optional meeting UUID"
          className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm"
        />
        <input ref={inputRef} type="file" accept="image/*,.pdf,text/plain" className="hidden" onChange={upload} />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm"
        >
          Choose file to upload
        </button>
      </div>
      <ul className="space-y-2">
        {files.map((f) => (
          <li key={f.id} className="flex items-center justify-between rounded-lg border border-gray-800 px-3 py-2 text-sm">
            <span className="text-gray-200 truncate">{f.original_name}</span>
            <button type="button" onClick={() => download(f)} className="text-blue-400 hover:text-blue-300 shrink-0 ml-2">
              Download
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
