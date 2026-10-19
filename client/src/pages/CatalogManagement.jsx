import React, { useState, useEffect } from 'react';
import { catalogApi } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { Plus, BookOpen, AlertTriangle, CheckCircle, Edit2, Layers, Search } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function CatalogManagement() {
  const { user } = useAuth();
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Add Book Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({
    title: '',
    author: '',
    isbn: '',
    category: 'Software Engineering',
    publisher: '',
    edition: '1st Edition',
    publicationYear: new Date().getFullYear(),
    copiesCount: 2
  });
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState(null);
  const [submittingAdd, setSubmittingAdd] = useState(false);

  // Add Copies Modal State
  const [copiesModalBook, setCopiesModalBook] = useState(null);
  const [copiesCountToAdd, setCopiesCountToAdd] = useState(1);
  const [copiesSuccess, setCopiesSuccess] = useState(null);
  const [copiesError, setCopiesError] = useState('');

  // Edit Book Modal State
  const [editModalBook, setEditModalBook] = useState(null);
  const [editForm, setEditForm] = useState({
    title: '',
    author: '',
    category: '',
    publisher: '',
    edition: '',
    publicationYear: '',
    newIsbn: ''
  });
  const [editError, setEditError] = useState('');
  const [editSuccess, setEditSuccess] = useState(null);

  const fetchBooks = async () => {
    setLoading(true);
    try {
      const res = await catalogApi.getBooks({ q: searchTerm, limit: 50 });
      if (res.success) setBooks(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBooks();
  }, [searchTerm]);

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    setAddError('');
    setAddSuccess(null);
    setSubmittingAdd(true);

    try {
      const res = await catalogApi.addBook(addForm);
      if (res.success) {
        setAddSuccess(`Book "${addForm.title}" added successfully! Generated accession numbers: ${res.accessionNumbers.join(', ')}`);
        setAddForm({
          title: '',
          author: '',
          isbn: '',
          category: 'Software Engineering',
          publisher: '',
          edition: '1st Edition',
          publicationYear: new Date().getFullYear(),
          copiesCount: 2
        });
        fetchBooks();
      }
    } catch (err) {
      setAddError(err.message || 'Error registering book title');
    } finally {
      setSubmittingAdd(false);
    }
  };

  const handleAddCopiesSubmit = async (e) => {
    e.preventDefault();
    setCopiesError('');
    setCopiesSuccess(null);
    try {
      const res = await catalogApi.addCopies(copiesModalBook.isbn, copiesCountToAdd);
      if (res.success) {
        setCopiesSuccess(`Added ${copiesCountToAdd} copy/copies! New Accession IDs: ${res.accessionNumbers.join(', ')}`);
        fetchBooks();
      }
    } catch (err) {
      setCopiesError(err.message || 'Error adding copies');
    }
  };

  const openEditModal = (b) => {
    setEditModalBook(b);
    setEditForm({
      title: b.title,
      author: b.author,
      category: b.category,
      publisher: b.publisher,
      edition: b.edition,
      publicationYear: b.publication_year || '',
      newIsbn: b.isbn
    });
    setEditError('');
    setEditSuccess(null);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setEditError('');
    try {
      const res = await catalogApi.updateBook(editModalBook.isbn, editForm);
      if (res.success) {
        setEditSuccess('Book details updated successfully!');
        setEditModalBook({ ...editModalBook, isbn: res.isbn || editModalBook.isbn });
        fetchBooks();
      }
    } catch (err) {
      setEditError(err.message || 'Update failed');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="border-b border-stone-200 pb-5 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-navy-900 tracking-tight">
            Catalog Management
          </h1>
          <p className="text-xs sm:text-sm text-stone-600 mt-1">
            Create new catalog records, validate ISBN-10/13 checksums, generate unique accession barcodes, and manage physical inventory.
          </p>
        </div>

        <button
          onClick={() => { setShowAddModal(true); setAddError(''); setAddSuccess(null); }}
          className="inline-flex items-center px-4 py-2 bg-navy-800 hover:bg-navy-900 text-white font-medium text-xs uppercase tracking-wider rounded shadow-sm transition self-start sm:self-auto"
        >
          <Plus className="w-4 h-4 mr-1.5" />
          Add New Book Title
        </button>
      </div>

      {/* Filter / Search Bar */}
      <div className="bg-white border border-stone-200 rounded p-4 mb-6 shadow-sm flex items-center justify-between">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search catalog by title, author, or ISBN..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 border border-stone-300 rounded text-xs focus:ring-1 focus:ring-navy-700 focus:outline-none"
          />
        </div>
      </div>

      {/* Catalog Table */}
      <div className="bg-white border border-stone-200 rounded overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-stone-700">
            <thead className="bg-stone-50 border-b border-stone-200 uppercase font-semibold tracking-wider text-[11px] text-stone-500">
              <tr>
                <th className="px-5 py-3">ISBN</th>
                <th className="px-5 py-3">Title & Edition</th>
                <th className="px-5 py-3">Author</th>
                <th className="px-5 py-3">Category</th>
                <th className="px-5 py-3">Publisher</th>
                <th className="px-5 py-3">Available / Total</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading ? (
                <tr>
                  <td colSpan="7" className="px-5 py-8 text-center text-stone-500 italic">
                    Loading book titles...
                  </td>
                </tr>
              ) : books.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-5 py-8 text-center text-stone-500">
                    No books in catalog matching criteria.
                  </td>
                </tr>
              ) : (
                books.map((b) => (
                  <tr key={b.isbn} className="hover:bg-stone-50/50">
                    <td className="px-5 py-3 font-mono font-bold text-stone-900">
                      {b.isbn}
                    </td>
                    <td className="px-5 py-3">
                      <Link to={`/catalog/${b.isbn}`} className="font-semibold text-navy-900 hover:underline">
                        {b.title}
                      </Link>
                      <div className="text-[11px] text-stone-500">{b.edition} ({b.publication_year || 'N/A'})</div>
                    </td>
                    <td className="px-5 py-3 text-stone-800 font-medium">
                      {b.author}
                    </td>
                    <td className="px-5 py-3">
                      <span className="px-2 py-0.5 rounded bg-stone-100 text-stone-700 border border-stone-200 text-[10px] font-semibold">
                        {b.category}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-stone-600">
                      {b.publisher}
                    </td>
                    <td className="px-5 py-3 font-mono">
                      <span className={b.available_copies > 0 ? 'text-emerald-800 font-bold' : 'text-amber-800 font-bold'}>
                        {b.available_copies}
                      </span>
                      <span className="text-stone-400"> / {b.total_copies}</span>
                    </td>
                    <td className="px-5 py-3 text-right space-x-1 whitespace-nowrap">
                      <button
                        onClick={() => { setCopiesModalBook(b); setCopiesCountToAdd(1); setCopiesSuccess(null); setCopiesError(''); }}
                        className="px-2.5 py-1 text-stone-700 hover:text-navy-900 bg-stone-100 hover:bg-stone-200 rounded border border-stone-300 font-medium text-xs"
                      >
                        + Copies
                      </button>
                      <button
                        onClick={() => openEditModal(b)}
                        className="px-2.5 py-1 text-stone-700 hover:text-navy-900 bg-stone-100 hover:bg-stone-200 rounded border border-stone-300 font-medium text-xs"
                      >
                        Edit
                      </button>
                      <Link
                        to={`/catalog/${b.isbn}`}
                        className="px-2.5 py-1 text-navy-800 hover:text-navy-900 bg-stone-50 hover:bg-stone-100 rounded border border-stone-300 font-medium text-xs inline-block"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ADD BOOK MODAL (FR-Catalog.Add-01 to 04) */}
      {showAddModal && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-stone-200 rounded max-w-lg w-full p-6 shadow-xl">
            <h2 className="font-serif font-bold text-lg text-navy-900 mb-1">
              Add New Catalog Book Title
            </h2>
            <p className="text-xs text-stone-500 mb-4">
              All fields are mandatory. ISBN must pass international checksum validation. Unique accession numbers are generated automatically.
            </p>

            {addError && (
              <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-900 text-xs flex items-start space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                <span>{addError}</span>
              </div>
            )}

            {addSuccess && (
              <div className="mb-4 p-3 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs">
                {addSuccess}
              </div>
            )}

            <form onSubmit={handleAddSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-stone-700 uppercase tracking-wider mb-1">
                  Book Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Design Patterns: Elements of Reusable Object-Oriented Software"
                  value={addForm.title}
                  onChange={(e) => setAddForm({ ...addForm, title: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-300 rounded text-xs focus:ring-1 focus:ring-navy-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    Author(s) *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Erich Gamma, Richard Helm..."
                    value={addForm.author}
                    onChange={(e) => setAddForm({ ...addForm, author: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 rounded text-xs focus:ring-1 focus:ring-navy-700"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    ISBN (10 or 13 digits) *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 9780201633610"
                    value={addForm.isbn}
                    onChange={(e) => setAddForm({ ...addForm, isbn: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 rounded text-xs font-mono focus:ring-1 focus:ring-navy-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    Category / Genre *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Software Architecture"
                    value={addForm.category}
                    onChange={(e) => setAddForm({ ...addForm, category: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 rounded text-xs focus:ring-1 focus:ring-navy-700"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    Publisher *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Addison-Wesley"
                    value={addForm.publisher}
                    onChange={(e) => setAddForm({ ...addForm, publisher: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 rounded text-xs focus:ring-1 focus:ring-navy-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    Edition *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 1st Edition"
                    value={addForm.edition}
                    onChange={(e) => setAddForm({ ...addForm, edition: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 rounded text-xs focus:ring-1 focus:ring-navy-700"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    Pub Year
                  </label>
                  <input
                    type="number"
                    value={addForm.publicationYear}
                    onChange={(e) => setAddForm({ ...addForm, publicationYear: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 rounded text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    Initial Copies *
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={addForm.copiesCount}
                    onChange={(e) => setAddForm({ ...addForm, copiesCount: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 rounded text-xs font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-4 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-2 border border-stone-300 rounded text-stone-700 hover:bg-stone-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAdd}
                  className="px-4 py-2 bg-navy-800 hover:bg-navy-900 text-white rounded font-semibold disabled:opacity-50"
                >
                  {submittingAdd ? 'Validating & Adding...' : 'Add Book & Generate Copies'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD COPIES MODAL */}
      {copiesModalBook && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-stone-200 rounded max-w-sm w-full p-6 shadow-xl">
            <h3 className="font-serif font-bold text-base text-navy-900 mb-1">
              Add Copies: {copiesModalBook.title}
            </h3>
            <p className="text-xs text-stone-500 mb-4 font-mono">
              ISBN: {copiesModalBook.isbn}
            </p>

            {copiesError && <div className="p-2.5 rounded bg-red-50 text-red-800 border border-red-200 text-xs mb-3">{copiesError}</div>}
            {copiesSuccess && <div className="p-2.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs mb-3">{copiesSuccess}</div>}

            <form onSubmit={handleAddCopiesSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Number of Copies to Add</label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  required
                  value={copiesCountToAdd}
                  onChange={(e) => setCopiesCountToAdd(e.target.value)}
                  className="w-full px-3 py-2 border border-stone-300 rounded text-sm font-mono"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setCopiesModalBook(null)}
                  className="px-3 py-1.5 border border-stone-300 rounded text-stone-700"
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-navy-800 text-white rounded font-semibold"
                >
                  Confirm Addition
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT BOOK MODAL (FR-Catalog.Update-01, FR-Catalog.Update-02) */}
      {editModalBook && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-stone-200 rounded max-w-lg w-full p-6 shadow-xl">
            <h2 className="font-serif font-bold text-lg text-navy-900 mb-1">
              Edit Catalog Book Details
            </h2>
            <p className="text-xs text-stone-500 mb-4 font-mono">
              Target ISBN: {editModalBook.isbn}
            </p>

            {editError && (
              <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-900 text-xs flex items-start space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                <span>{editError}</span>
              </div>
            )}
            {editSuccess && <div className="mb-4 p-2.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs">{editSuccess}</div>}

            <form onSubmit={handleEditSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-stone-700 mb-1">ISBN</label>
                <input
                  type="text"
                  value={editForm.newIsbn}
                  onChange={(e) => setEditForm({ ...editForm, newIsbn: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-300 rounded font-mono"
                />
                <span className="text-[11px] text-stone-500 mt-0.5 block">Can be corrected only until the first copy of this title is issued (FR-Catalog.Update-02).</span>
              </div>
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Book Title</label>
                <input
                  type="text"
                  value={editForm.title}
                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-300 rounded"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Author</label>
                  <input
                    type="text"
                    value={editForm.author}
                    onChange={(e) => setEditForm({ ...editForm, author: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 rounded"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Category</label>
                  <input
                    type="text"
                    value={editForm.category}
                    onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 rounded"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Publisher</label>
                  <input
                    type="text"
                    value={editForm.publisher}
                    onChange={(e) => setEditForm({ ...editForm, publisher: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 rounded"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Edition</label>
                  <input
                    type="text"
                    value={editForm.edition}
                    onChange={(e) => setEditForm({ ...editForm, edition: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 rounded"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Year</label>
                  <input
                    type="number"
                    value={editForm.publicationYear}
                    onChange={(e) => setEditForm({ ...editForm, publicationYear: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 rounded font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setEditModalBook(null)}
                  className="px-3 py-2 border border-stone-300 rounded text-stone-700"
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-navy-800 text-white rounded font-semibold"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
