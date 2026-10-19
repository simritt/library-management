import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { catalogApi } from '../utils/api';
import { Search, Filter, BookOpen, CheckCircle, Clock, BookX, ArrowUpDown } from 'lucide-react';

export default function CatalogSearch() {
  const [books, setBooks] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Search and filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [sortBy, setSortBy] = useState('title');
  const [sortOrder, setSortOrder] = useState('ASC');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalResults, setTotalResults] = useState(0);

  // Fetch categories on mount
  useEffect(() => {
    catalogApi.getCategories().then((res) => {
      if (res.success) setCategories(res.categories);
    }).catch(console.error);
  }, []);

  const fetchBooks = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await catalogApi.getBooks({
        q: searchTerm,
        category: selectedCategory,
        availableOnly: availableOnly ? 'true' : 'false',
        sortBy,
        order: sortOrder,
        page: currentPage,
        limit: 12
      });

      if (res.success) {
        setBooks(res.data);
        setTotalPages(res.pagination.totalPages || 1);
        setTotalResults(res.pagination.total || 0);
      }
    } catch (err) {
      setError(err.message || 'Failed to load catalog');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBooks();
  }, [selectedCategory, availableOnly, sortBy, sortOrder, currentPage]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setCurrentPage(1);
    fetchBooks();
  };

  const handleResetFilters = () => {
    setSearchTerm('');
    setSelectedCategory('All');
    setAvailableOnly(false);
    setSortBy('title');
    setSortOrder('ASC');
    setCurrentPage(1);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header section with scholarly styling */}
      <div className="border-b border-stone-200 pb-6 mb-8">
        <h1 className="text-3xl font-serif font-bold text-navy-900 tracking-tight">
          Library Catalog
        </h1>
        <p className="text-sm text-stone-600 mt-1 max-w-2xl">
          Search the institution's complete collection of engineering texts, computer science treatises, monographs, and journals. Real-time physical copy availability is verified live against our inventory.
        </p>
      </div>

      {/* Search and Filter Bar */}
      <div className="bg-white border border-stone-200 rounded p-4 mb-8 shadow-sm">
        <form onSubmit={handleSearchSubmit} className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-3" />
              <input
                type="text"
                placeholder="Search by title, author, ISBN (10/13 digits), or keywords..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-stone-300 rounded text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700 bg-stone-50/50"
              />
            </div>
            <button
              type="submit"
              className="px-5 py-2 bg-navy-800 hover:bg-navy-900 text-white font-medium text-sm rounded transition shadow-sm"
            >
              Search
            </button>
            {(searchTerm || selectedCategory !== 'All' || availableOnly) && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-3.5 py-2 border border-stone-300 text-stone-700 hover:bg-stone-50 font-medium text-sm rounded transition"
              >
                Clear
              </button>
            )}
          </div>

          {/* Filtering & Sorting Controls */}
          <div className="pt-3 border-t border-stone-100 flex flex-wrap items-center justify-between gap-4 text-xs text-stone-700">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-stone-500 uppercase tracking-wider text-[11px]">Category:</span>
                <select
                  value={selectedCategory}
                  onChange={(e) => { setSelectedCategory(e.target.value); setCurrentPage(1); }}
                  className="border border-stone-300 rounded px-2.5 py-1 bg-white text-stone-800 text-xs focus:ring-1 focus:ring-navy-700"
                >
                  <option value="All">All Categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <label className="flex items-center space-x-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={availableOnly}
                  onChange={(e) => { setAvailableOnly(e.target.checked); setCurrentPage(1); }}
                  className="rounded border-stone-300 text-navy-800 focus:ring-navy-700 h-3.5 w-3.5"
                />
                <span className="font-medium text-stone-800">Available Now Only</span>
              </label>
            </div>

            <div className="flex items-center space-x-2">
              <span className="font-semibold text-stone-500 uppercase tracking-wider text-[11px]">Sort By:</span>
              <select
                value={sortBy}
                onChange={(e) => { setSortBy(e.target.value); setCurrentPage(1); }}
                className="border border-stone-300 rounded px-2 py-1 bg-white text-stone-800 text-xs"
              >
                <option value="title">Title (Alphabetical)</option>
                <option value="author">Author</option>
                <option value="year">Publication Year</option>
              </select>

              <button
                type="button"
                onClick={() => setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC')}
                title="Toggle sort direction"
                className="p-1 border border-stone-300 rounded hover:bg-stone-50 text-stone-600"
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Results Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs text-stone-500">
          Showing <span className="font-semibold text-stone-800">{books.length}</span> of <span className="font-semibold text-stone-800">{totalResults}</span> titles
        </div>
      </div>

      {/* Books Grid */}
      {loading ? (
        <div className="text-center py-20 bg-white border border-stone-200 rounded">
          <p className="text-stone-500 font-serif italic text-base">Retrieving catalog records...</p>
        </div>
      ) : books.length === 0 ? (
        <div className="text-center py-16 bg-white border border-stone-200 rounded px-4">
          <BookX className="w-10 h-10 text-stone-400 mx-auto mb-3" />
          <h3 className="font-serif text-lg font-bold text-navy-900 mb-1">No Books Matching Criteria Found</h3>
          <p className="text-sm text-stone-600 max-w-md mx-auto mb-4">
            Try adjusting your search query, or clear active category and availability filters to browse all titles.
          </p>
          <button
            onClick={handleResetFilters}
            className="px-4 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-semibold rounded border border-stone-300 transition"
          >
            Clear Search & Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {books.map((b) => {
            const isAvailable = b.available_copies > 0;
            return (
              <div
                key={b.isbn}
                className="bg-white border border-stone-200 rounded p-5 flex flex-col justify-between hover:border-stone-400 transition"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-stone-100 text-stone-700 border border-stone-200">
                      {b.category}
                    </span>
                    <span className="text-[11px] text-stone-400 font-mono">
                      {b.publication_year || 'N/A'}
                    </span>
                  </div>

                  <h3 className="font-serif font-bold text-base text-navy-900 leading-snug line-clamp-2 mb-1">
                    <Link to={`/catalog/${b.isbn}`} className="hover:underline">
                      {b.title}
                    </Link>
                  </h3>

                  <p className="text-xs text-stone-600 mb-3 font-medium">
                    {b.author}
                  </p>

                  <div className="text-[11px] text-stone-500 space-y-1 mb-4 border-t border-stone-100 pt-2.5">
                    <div><span className="text-stone-400">ISBN:</span> <span className="font-mono text-stone-700">{b.isbn}</span></div>
                    <div><span className="text-stone-400">Publisher:</span> {b.publisher} ({b.edition})</div>
                  </div>
                </div>

                <div className="pt-3 border-t border-stone-100">
                  <div className="flex items-center justify-between mb-3 text-xs">
                    <span className="text-stone-500">Live Copies:</span>
                    {isAvailable ? (
                      <span className="inline-flex items-center text-emerald-800 font-medium">
                        <CheckCircle className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                        {b.available_copies} of {b.total_copies} available
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-amber-800 font-medium">
                        <Clock className="w-3.5 h-3.5 mr-1 text-amber-600" />
                        0 of {b.total_copies} available
                      </span>
                    )}
                  </div>

                  {!isAvailable && b.earliest_expected_return && (
                    <div className="bg-amber-50/70 border border-amber-200/80 rounded px-2.5 py-1 text-[11px] text-amber-900 mb-3 flex items-center justify-between">
                      <span>Earliest expected return:</span>
                      <span className="font-medium font-mono">{b.earliest_expected_return}</span>
                    </div>
                  )}

                  <div className="flex items-center space-x-2">
                    <Link
                      to={`/catalog/${b.isbn}`}
                      className="w-full text-center px-3 py-1.5 bg-stone-100 hover:bg-stone-200 border border-stone-300 text-stone-800 text-xs font-medium rounded transition"
                    >
                      View Details & Copies
                    </Link>
                    {!isAvailable && (
                      <Link
                        to={`/catalog/${b.isbn}`}
                        className="shrink-0 text-center px-3 py-1.5 bg-navy-800 hover:bg-navy-900 text-white text-xs font-semibold rounded transition"
                      >
                        Reserve
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center space-x-2">
          <button
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            className="px-3 py-1.5 border border-stone-300 rounded text-xs font-medium bg-white text-stone-700 hover:bg-stone-50 disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-xs text-stone-600 px-2 font-mono">
            Page {currentPage} of {totalPages}
          </span>
          <button
            disabled={currentPage >= totalPages}
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            className="px-3 py-1.5 border border-stone-300 rounded text-xs font-medium bg-white text-stone-700 hover:bg-stone-50 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
