import { Router } from 'express';
import * as controller from './account.controller.js';

// The logged-in person's own settings.
const router = Router();

router.get('/', controller.get);
router.put('/professional', controller.updateProfessional);
router.put('/appearance', controller.updateAppearance);
router.put('/profile', controller.updateProfile);
// the profile photo: GET the picture, PUT { image: data URL } (shrunk by the website), DELETE to remove it
router.get('/photo', controller.photo);
router.put('/photo', controller.setPhoto);
router.delete('/photo', controller.removePhoto);

export default router;
