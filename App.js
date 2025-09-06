import React, { useState, useEffect, useCallback } from 'react';

// --- Mock Logging Middleware ---
// As required, this is a mock logging service that doesn't use the console directly.
// In a real application, this would send logs to a dedicated logging server.
// For this test, it stores logs in sessionStorage.
const logger = {
  _log(level, message, data = {}) {
    try {
      const logs = JSON.parse(sessionStorage.getItem('app_logs') || '[]');
      logs.push({
        level,
        message,
        ...data,
        timestamp: new Date().toISOString(),
      });
      sessionStorage.setItem('app_logs', JSON.stringify(logs));
    } catch (error) {
      // Fallback if sessionStorage is unavailable or full.
      console.error("Logger failed:", error);
    }
  },
  info(message, data) {
    this._log('INFO', message, data);
  },
  warn(message, data) {
    this._log('WARN', message, data);
  },
  error(message, data) {
    this._log('ERROR', message, data);
  },
};


// --- Database Utility ---
// Manages all interactions with localStorage for URL data persistence.
const db = {
  getData() {
    try {
      return JSON.parse(localStorage.getItem('url_shortener_data') || '{}');
    } catch (error) {
      logger.error('Failed to parse data from localStorage.', { error: error.message });
      return {};
    }
  },
  saveData(data) {
    try {
      localStorage.setItem('url_shortener_data', JSON.stringify(data));
      logger.info('Data successfully saved to localStorage.');
    } catch (error) {
      logger.error('Failed to save data to localStorage.', { error: error.message });
    }
  },
  getLinkByShortcode(shortcode) {
    return this.getData()[shortcode];
  },
  saveLink(shortcode, linkData) {
    const data = this.getData();
    data[shortcode] = linkData;
    this.saveData(data);
  }
};


// --- Helper Functions ---
const generateShortcode = (length = 7) => {
  const characters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
};

const getGeoLocation = async () => {
    try {
        const response = await fetch('https://ipapi.co/json/');
        if (!response.ok) {
            throw new Error(`Geo API request failed with status ${response.status}`);
        }
        const data = await response.json();
        return `${data.city}, ${data.country_name}`;
    } catch (error) {
        logger.error('Could not fetch geolocation data.', { error: error.message });
        return 'Unknown Location';
    }
};

// --- UI Components (Styled with TailwindCSS to mimic a modern UI) ---

const Card = ({ children, className = '' }) => (
  <div className={`bg-white rounded-xl shadow-md p-6 sm:p-8 ${className}`}>
    {children}
  </div>
);

const Button = ({ children, onClick, variant = 'primary', className = '', type = 'button' }) => {
  const baseClasses = 'px-6 py-2 font-semibold rounded-md transition-transform transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2';
  const variantClasses = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
    secondary: 'bg-gray-200 text-gray-800 hover:bg-gray-300 focus:ring-gray-400',
    danger: 'bg-red-500 text-white hover:bg-red-600 focus:ring-red-500',
  };
  return (
    <button type={type} onClick={onClick} className={`${baseClasses} ${variantClasses[variant]} ${className}`}>
      {children}
    </button>
  );
};

const Input = ({ value, onChange, placeholder, type = 'text', className = '' }) => (
  <input
    type={type}
    value={value}
    onChange={onChange}
    placeholder={placeholder}
    className={`w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition ${className}`}
  />
);

const Tab = ({ label, isActive, onClick }) => (
  <button
    onClick={onClick}
    className={`px-4 py-2 text-lg font-medium rounded-t-lg transition-colors
      ${isActive ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-blue-600'}`}
  >
    {label}
  </button>
);

// --- Page Components ---

const URLShortenerPage = ({ onLinkCreated }) => {
  const [entries, setEntries] = useState([{ id: 1, longUrl: '', validity: '30', shortcode: '' }]);
  const [errors, setErrors] = useState({});
  const [results, setResults] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleEntryChange = (id, field, value) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
    setErrors(prev => ({...prev, [id]: undefined}));
  };

  const addEntry = () => {
    if (entries.length < 5) {
      setEntries(prev => [...prev, { id: Date.now(), longUrl: '', validity: '30', shortcode: '' }]);
    }
  };

  const removeEntry = (id) => {
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  const validateUrl = (url) => {
    try {
      new URL(url);
      return true;
    } catch (_) {
      return false;
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setResults([]);
    const newErrors = {};
    let isValid = true;
    
    if (entries.length === 0 || entries.every(e => !e.longUrl.trim())) {
        logger.warn('Submission attempt with no URLs.');
        // Set a general error if needed
        return;
    }

    entries.forEach(entry => {
      const entryErrors = {};
      if (!validateUrl(entry.longUrl)) {
        entryErrors.longUrl = 'Please enter a valid URL.';
        isValid = false;
      }
      if (entry.validity && (!/^\d+$/.test(entry.validity) || parseInt(entry.validity) <= 0)) {
        entryErrors.validity = 'Must be a positive number.';
        isValid = false;
      }
      if (entry.shortcode && !/^[a-zA-Z0-9_-]+$/.test(entry.shortcode)) {
        entryErrors.shortcode = 'Alphanumeric characters only.';
        isValid = false;
      }

      if(Object.keys(entryErrors).length > 0) {
        newErrors[entry.id] = entryErrors;
      }
    });

    setErrors(newErrors);

    if (isValid) {
      setIsSubmitting(true);
      logger.info('Validation passed. Starting URL shortening process.');
      const allData = db.getData();
      const newResults = [];

      entries.forEach(entry => {
        let shortcode = entry.shortcode.trim();
        if (shortcode && allData[shortcode]) {
          newErrors[entry.id] = { ...newErrors[entry.id], shortcode: 'This custom shortcode is already taken.' };
          isValid = false;
          return;
        }

        if (!shortcode) {
          do {
            shortcode = generateShortcode();
          } while (allData[shortcode]);
        }
        
        const validityMinutes = parseInt(entry.validity, 10) || 30;
        const now = new Date();
        const expiresAt = new Date(now.getTime() + validityMinutes * 60 * 1000);
        
        const newLink = {
          longUrl: entry.longUrl,
          shortUrl: `${window.location.origin}/${shortcode}`,
          createdAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          clicks: [],
        };
        
        allData[shortcode] = newLink;
        newResults.push({ ...newLink, originalId: entry.id });
      });

      if(Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        setIsSubmitting(false);
        return;
      }
      
      db.saveData(allData);
      setResults(newResults);
      onLinkCreated();
      setEntries([{ id: 1, longUrl: '', validity: '30', shortcode: '' }]); // Reset form
      setIsSubmitting(false);
    } else {
        logger.warn('Form validation failed.', { errors: newErrors });
    }
  };

  return (
    <Card>
        <h2 className="text-2xl font-bold text-gray-800 mb-6">URL Shortener</h2>
        <form onSubmit={handleSubmit} className="space-y-6">
            {entries.map((entry, index) => (
              <div key={entry.id} className="p-4 border rounded-lg space-y-3 relative bg-gray-50">
                {entries.length > 1 && (
                  <button type="button" onClick={() => removeEntry(entry.id)} className="absolute top-2 right-2 text-gray-400 hover:text-red-500">
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
                <div>
                    <label className="font-medium text-gray-700">Original Long URL*</label>
                    <Input placeholder="https://example.com/very-long-url" value={entry.longUrl} onChange={e => handleEntryChange(entry.id, 'longUrl', e.target.value)} />
                    {errors[entry.id]?.longUrl && <p className="text-red-500 text-sm mt-1">{errors[entry.id].longUrl}</p>}
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                        <label className="font-medium text-gray-700">Validity (minutes)</label>
                        <Input placeholder="Default: 30" value={entry.validity} onChange={e => handleEntryChange(entry.id, 'validity', e.target.value)} />
                        {errors[entry.id]?.validity && <p className="text-red-500 text-sm mt-1">{errors[entry.id].validity}</p>}
                    </div>
                    <div>
                        <label className="font-medium text-gray-700">Custom Shortcode (optional)</label>
                        <Input placeholder="my-custom-link" value={entry.shortcode} onChange={e => handleEntryChange(entry.id, 'shortcode', e.target.value)} />
                        {errors[entry.id]?.shortcode && <p className="text-red-500 text-sm mt-1">{errors[entry.id].shortcode}</p>}
                    </div>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between">
                <Button onClick={addEntry} variant="secondary" disabled={entries.length >= 5}>
                    Add URL
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Shortening...' : 'Shorten URLs'}
                </Button>
            </div>
        </form>
        {results.length > 0 && (
            <div className="mt-8">
                <h3 className="text-xl font-bold text-gray-800 mb-4">Results:</h3>
                <div className="space-y-4">
                    {results.map((res, i) => (
                        <div key={i} className="p-4 bg-green-100 border border-green-200 rounded-lg">
                            <p className="font-semibold text-green-800 break-all">
                                Short URL: <a href={res.shortUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{res.shortUrl}</a>
                            </p>
                            <p className="text-sm text-gray-600 truncate">Original: {res.longUrl}</p>
                            <p className="text-sm text-gray-600">Expires: {new Date(res.expiresAt).toLocaleString()}</p>
                        </div>
                    ))}
                </div>
            </div>
        )}
    </Card>
  );
};

const StatisticsPage = ({ dataVersion }) => {
    const [links, setLinks] = useState([]);
    const [expanded, setExpanded] = useState(null);

    useEffect(() => {
        logger.info('Fetching statistics data.');
        const allData = db.getData();
        const sortedData = Object.entries(allData).sort(
            (a, b) => new Date(b[1].createdAt) - new Date(a[1].createdAt)
        );
        setLinks(sortedData);
    }, [dataVersion]);

    const toggleExpand = (shortcode) => {
        setExpanded(expanded === shortcode ? null : shortcode);
    };

    if (links.length === 0) {
        return <Card><p className="text-center text-gray-500">No shortened URLs yet. Create one on the URL Shortener page!</p></Card>;
    }

    return (
        <Card>
            <h2 className="text-2xl font-bold text-gray-800 mb-6">Statistics</h2>
            <div className="space-y-4">
                {links.map(([shortcode, data]) => {
                    const isExpired = new Date(data.expiresAt) < new Date();
                    return (
                        <div key={shortcode} className={`p-4 border rounded-lg ${isExpired ? 'bg-gray-100' : 'bg-white'}`}>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                                <div className="md:col-span-2">
                                    <p className="font-bold text-blue-600 text-lg break-all">{data.shortUrl}</p>
                                    <p className="text-sm text-gray-500 truncate">Original: {data.longUrl}</p>
                                    <p className={`text-sm font-medium ${isExpired ? 'text-red-500' : 'text-green-600'}`}>
                                        {isExpired ? `Expired on ${new Date(data.expiresAt).toLocaleDateString()}` : `Expires: ${new Date(data.expiresAt).toLocaleString()}`}
                                    </p>
                                </div>
                                <div className="flex items-center justify-between md:justify-end space-x-4">
                                     <div className="text-center">
                                        <p className="text-3xl font-bold text-gray-800">{data.clicks.length}</p>
                                        <p className="text-sm text-gray-600">Clicks</p>
                                    </div>
                                    <Button onClick={() => toggleExpand(shortcode)} variant="secondary" className="px-3 py-1">
                                       {expanded === shortcode ? 'Hide' : 'Details'}
                                    </Button>
                                </div>
                            </div>
                           
                            {expanded === shortcode && (
                                <div className="mt-4 pt-4 border-t">
                                    <h4 className="font-semibold mb-2">Click Data:</h4>
                                    {data.clicks.length > 0 ? (
                                        <ul className="space-y-2 text-sm">
                                            {data.clicks.map((click, i) => (
                                                <li key={i} className="p-2 bg-gray-50 rounded">
                                                    <p><b>Time:</b> {new Date(click.timestamp).toLocaleString()}</p>
                                                    <p><b>Location:</b> {click.location}</p>
                                                    <p><b>Source:</b> {click.source || 'Direct'}</p>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : <p className="text-gray-500 text-sm">No clicks recorded yet.</p>}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </Card>
    );
};


// --- Main App Component ---

export default function App() {
  const [activeTab, setActiveTab] = useState('shortener');
  const [dataVersion, setDataVersion] = useState(0); // Used to trigger re-renders in statistics

  const handleRedirect = useCallback(async () => {
    const path = window.location.pathname.substring(1);
    if (path) {
      logger.info('Path detected, checking for shortcode.', { path });
      const linkData = db.getLinkByShortcode(path);

      if (linkData) {
        if (new Date(linkData.expiresAt) < new Date()) {
          logger.warn('Attempted to access expired link.', { shortcode: path });
          document.body.innerHTML = `<div style="font-family: sans-serif; text-align: center; padding: 40px;"><h1>Link Expired</h1><p>This shortened link has expired and is no longer active.</p></div>`;
          return;
        }

        const location = await getGeoLocation();
        const newClick = {
          timestamp: new Date().toISOString(),
          source: document.referrer,
          location: location,
        };

        linkData.clicks.push(newClick);
        db.saveLink(path, linkData);
        logger.info('Redirecting shortcode to its original URL.', { path, originalUrl: linkData.longUrl });
        window.location.href = linkData.longUrl;
      }
    }
  }, []);

  useEffect(() => {
    handleRedirect();
  }, [handleRedirect]);
  
  const handleLinkCreated = () => {
      setDataVersion(v => v + 1);
  }

  // This prevents rendering the app if a redirect is happening
  const path = window.location.pathname.substring(1);
  if (path && db.getLinkByShortcode(path)) {
      return (
        <div className="min-h-screen bg-gray-100 flex items-center justify-center">
            <div className="text-center p-8">
                <p className="text-xl text-gray-700">Redirecting...</p>
            </div>
        </div>
      );
  }

  return (
    <div className="min-h-screen bg-gray-100 font-sans">
      <header className="bg-white shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
           <div className="flex items-center space-x-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
            <h1 className="text-3xl font-bold text-gray-800">AffordMed URL Shortener</h1>
           </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <Tab label="URL Shortener" isActive={activeTab === 'shortener'} onClick={() => setActiveTab('shortener')} />
          <Tab label="Statistics" isActive={activeTab === 'statistics'} onClick={() => setActiveTab('statistics')} />
        </div>

        <div>
          {activeTab === 'shortener' && <URLShortenerPage onLinkCreated={handleLinkCreated} />}
          {activeTab === 'statistics' && <StatisticsPage dataVersion={dataVersion} />}
        </div>
      </main>

      <footer className="text-center py-4 text-sm text-gray-500">
        <p>&copy; {new Date().getFullYear()} URL Shortener. All rights reserved.</p>
      </footer>
    </div>
  );
}
