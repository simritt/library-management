const express = require('express');
const router = express.Router();
const catalogController = require('../controllers/catalogController');
const { requireStaff } = require('../middlewares/authMiddleware');

// Public endpoints (SE-2: Catalog search and viewing book availability permitted without login)
router.get('/books', catalogController.getBooks);
router.get('/books/:isbn', catalogController.getBookByIsbn);
router.get('/categories', catalogController.getCategories);

// Staff-only endpoints (SE-4: Catalog maintenance)
router.post('/books', requireStaff, catalogController.addBook);
router.put('/books/:isbn', requireStaff, catalogController.updateBook);
router.post('/books/:isbn/copies', requireStaff, catalogController.addCopies);
router.patch('/copies/:accessionNumber/status', requireStaff, catalogController.updateCopyStatus);

module.exports = router;
