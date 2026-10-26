import { Button } from '../components/ui';
import { useDocumentTitle } from '../lib/hooks';

export const NotFoundPage = () => {
  useDocumentTitle('Page not found');

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center gap-7 px-4 text-center">
      <p className="eyebrow">404</p>
      <div className="space-y-3">
        <h1 className="text-display-lg">This wall is empty</h1>
        <p className="lede">
          Whatever used to hang here has moved. The rest of the collection is where you left it.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button variant="primary" to="/">
          Back to the entrance
        </Button>
        <Button variant="secondary" to="/shop">
          Explore the collection
        </Button>
        <Button variant="ghost" to="/gallery">
          Enter the gallery
        </Button>
      </div>
    </div>
  );
};

export default NotFoundPage;
