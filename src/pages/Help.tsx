import { useParams } from 'react-router-dom';
import { MyHelpRequests } from '../components/CustomerHelp';
import { TopBar } from '../components/ui';
import { isUuid } from '../lib/types';

export default function Help() {
  const { placeId } = useParams();
  return <div className="page"><TopBar title="Your help requests" />{placeId && !isUuid(placeId) ? <p className="notice err">This shop link is invalid.</p> : <MyHelpRequests placeId={placeId} />}</div>;
}
