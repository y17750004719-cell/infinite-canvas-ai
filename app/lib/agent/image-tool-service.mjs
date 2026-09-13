import { POST as generateImage } from '../../api/generate/route';
import { dispatchImageGeneration } from './application-tool-dispatcher.mjs';
export { resolveImageExecutionSelection } from './image-provider-selection.mjs';

/** Keep the generate route behind the application image boundary. */
export async function executeImageRequest(request) {
  return dispatchImageGeneration({ generateImage, request });
}
