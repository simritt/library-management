import React from 'react';
import { HelpCircle, BookOpen, Clock, AlertTriangle, ShieldCheck, Check } from 'lucide-react';

export default function Help() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="border-b border-stone-200 pb-5">
        <h1 className="text-3xl font-serif font-bold text-navy-900 tracking-tight">
          Library System User Guide & Regulations
        </h1>
        <p className="text-sm text-stone-600 mt-1">
          Complies with SRS Section 2.6 (UD-1, UD-2) and institutional library policies (Sardar Patel Institute of Technology).
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-stone-700">
        <div className="bg-white border border-stone-200 rounded p-6 shadow-sm">
          <h2 className="font-serif font-bold text-base text-navy-900 mb-2 flex items-center space-x-2">
            <BookOpen className="w-4 h-4 text-navy-800" />
            <span>Patron Borrowing Limits (BR-1, BR-2)</span>
          </h2>
          <ul className="space-y-2 mt-3 text-stone-600">
            <li>• <strong>Students:</strong> Entitled to borrow up to <strong>3 books</strong> simultaneously for a standard loan period of <strong>14 calendar days</strong>.</li>
            <li>• <strong>Faculty Members:</strong> Entitled to borrow up to <strong>8 books</strong> simultaneously for a loan period of <strong>30 calendar days</strong>.</li>
            <li>• Check your due dates, fines and reservations any time under <strong>My account</strong>. Issue and return are done at the library desk.</li>
            <li>• Can't find a title? Use <strong>Book requests</strong> to ask the library for it (ISBN and preferred loan duration within your limit).</li>
          </ul>
        </div>

        <div className="bg-white border border-stone-200 rounded p-6 shadow-sm">
          <h2 className="font-serif font-bold text-base text-navy-900 mb-2 flex items-center space-x-2">
            <Clock className="w-4 h-4 text-amber-700" />
            <span>Overdue Fines & Caps (BR-4, BR-5, BR-6)</span>
          </h2>
          <ul className="space-y-2 mt-3 text-stone-600">
            <li>• <strong>Fine Rate:</strong> <strong>Rs. 2.00 per day</strong> per volume overdue past the recorded due date.</li>
            <li>• <strong>Maximum Fine Cap:</strong> Maximum fine charged for a single loan is capped at <strong>Rs. 200.00</strong>.</li>
            <li>• <strong>Borrowing Lockout:</strong> Members with cumulative outstanding fines exceeding <strong>Rs. 100.00</strong> are automatically blocked from borrowing additional books until dues are paid.</li>
          </ul>
        </div>

        <div className="bg-white border border-stone-200 rounded p-6 shadow-sm">
          <h2 className="font-serif font-bold text-base text-navy-900 mb-2 flex items-center space-x-2">
            <HelpCircle className="w-4 h-4 text-purple-700" />
            <span>Reservations & Hold Queue (BR-7)</span>
          </h2>
          <ul className="space-y-2 mt-3 text-stone-600">
            <li>• Reservations may be placed online (patron sign-in required) or at the circulation desk when <strong>all copies</strong> of a requested title are currently on loan.</li>
            <li>• You may hold one active reservation per title and can cancel it any time from <strong>My account</strong>.</li>
            <li>• Maintained in strictly FIFO (first-come, first-served) sequence.</li>
            <li>• When a reserved volume is returned, it is held exclusively for the next member in queue for <strong>48 hours</strong>.</li>
          </ul>
        </div>

        <div className="bg-white border border-stone-200 rounded p-6 shadow-sm">
          <h2 className="font-serif font-bold text-base text-navy-900 mb-2 flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 text-emerald-700" />
            <span>Role-Based Access Control (SE-4, SE-5, BR-8)</span>
          </h2>
          <ul className="space-y-2 mt-3 text-stone-600">
            <li>• <strong>Public / Anonymous:</strong> Real-time catalog search and copy availability view (no login required).</li>
            <li>• <strong>Librarian:</strong> Circulation desk issue/return, member registration and search, fine collection, reservation queue and copy status tagging (Lost / Damaged).</li>
            <li>• <strong>Library Administrator:</strong> Fine waivers (mandatory audit remark required), policy settings configuration, member deactivation, and analytics reporting.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
