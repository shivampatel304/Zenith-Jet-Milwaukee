import { useState, FormEvent } from 'react';
import { verifyPin } from '../lib/api';

interface Props {
  onSuccess: () => void;
}

export default function PinGate({ onSuccess }: Props) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const ok = await verifyPin(pin);
    setLoading(false);

    if (ok) {
      onSuccess();
    } else {
      setError('Invalid PIN. Please try again.');
      setPin('');
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-gray-900">
      <div className="bg-white rounded-2xl shadow-2xl p-10 w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-3xl font-bold text-gray-900 mb-1">Milwaukee</div>
          <div className="text-gray-500 text-sm">Building Intelligence Platform</div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={pin}
            onChange={e => setPin(e.target.value)}
            placeholder="Enter 6-digit PIN"
            maxLength={6}
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-center text-2xl tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />

          {error && (
            <p className="text-red-500 text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || pin.length !== 6}
            className="w-full bg-gray-900 text-white rounded-lg px-4 py-3 font-medium hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Verifying…' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  );
}
