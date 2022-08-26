
import googleAPI from 'googleapis';
const google = googleAPI.google; 
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
oauth2Client.setCredentials({refresh_token: REFRESH_TOKEN});

const drive = google.drive({
    version: 'v3',
    auth: oauth2Client
})

async function uploadFile (file, folderID, fileName, mimeType) {
    try {
        await drive.files.create({
            resource: {
                'name': fileName,
                'parents': [folderID]
            },
            media: {
                'mimeType': mimeType,
                'body': file
            }
        });
        return true;
    } catch (err) {
        console.log(err);
        return false;
    }
};

async function cleanDirectory (folderID) {
    try {
        const list = await drive.files.list({
            q: `'${folderID}' in parents`
        });
        if (!list) return true;
        const promises = list.data.files.map(async (file) => await drive.files.delete({fileId: file.id}));
        
        await Promise.all(promises);
        return true
    } catch (err) {
        console.log(err);
        return false
    }
};

export { uploadFile, cleanDirectory };